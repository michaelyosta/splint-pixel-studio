#requires -Version 5.1

param(
  [switch]$Restart,
  [switch]$UnsafePublicDevAuth,
  [Parameter(ValueFromRemainingArguments = $true)]
  [string[]]$ModeArgs
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runDir = Join-Path $projectRoot '.run'
$logsDir = Join-Path $projectRoot '.logs'
$envFile = Join-Path $projectRoot '.env.local'

if (-not (Test-Path $runDir)) { New-Item -ItemType Directory -Path $runDir -Force | Out-Null }
if (-not (Test-Path $logsDir)) { New-Item -ItemType Directory -Path $logsDir -Force | Out-Null }

$apiPidFile = Join-Path $runDir 'api.pid'
$vitePidFile = Join-Path $runDir 'vite.pid'
$cloudflaredPidFile = Join-Path $runDir 'cloudflared.pid'
$apiLogFile = Join-Path $logsDir 'api.log'
$viteLogFile = Join-Path $logsDir 'vite.log'
$cloudflaredLogFile = Join-Path $logsDir 'cloudflared.log'
$apiPort = 3001
$vitePort = 5173

# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

function Write-Banner {
  Write-Host ''
  Write-Host 'SPLINT Pixel Studio Launcher' -ForegroundColor Cyan
  Write-Host ''
}

function Test-NodeVersion {
  $required = [Version]'20.6.0'
  try {
    $raw = & node --version 2>$null
    if (-not $raw) { throw 'Node.js not found in PATH' }
    $version = [Version]($raw -replace '^v', '')
    if ($version -lt $required) {
      Write-Error "Node.js $version is too old. Required: >= $required (for --env-file support)"
      exit 1
    }
  } catch {
    Write-Error "Node.js check failed: $_"
    exit 1
  }
}

function Read-EnvLocal {
  if (-not (Test-Path $envFile)) {
    Write-Error ".env.local not found at $envFile. Run: Copy-Item .env.example .env.local and edit it."
    exit 1
  }
  $envVars = @{}
  Get-Content $envFile | ForEach-Object {
    $line = $_.Trim()
    if ($line -and -not $line.StartsWith('#') -and $line.Contains('=')) {
      $parts = $line.Split('=', 2)
      $key = $parts[0].Trim()
      $val = $parts[1].Trim()
      if ($val.StartsWith('"') -and $val.EndsWith('"')) { $val = $val.Substring(1, $val.Length - 2) }
      elseif ($val.StartsWith("'") -and $val.EndsWith("'")) { $val = $val.Substring(1, $val.Length - 2) }
      $envVars[$key] = $val
    }
  }
  return $envVars
}

function Get-EnvValueOrDefault {
  param(
    [hashtable]$Values,
    [string]$Name,
    [string]$DefaultValue
  )

  if ($Values.ContainsKey($Name)) {
    $value = [string]$Values[$Name]
    if (-not [string]::IsNullOrWhiteSpace($value)) {
      return $value
    }
  }

  return $DefaultValue
}

function Test-ListeningPort([int]$Port) {
  return [bool](Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue)
}

function Get-PortOwner([int]$Port) {
  $connections = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
  if (-not $connections) { return $null }
  $procId = $connections[0].OwningProcess
  if (-not $procId -or $procId -eq 0) { return $null }
  try {
    $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
    return @{ PID = $procId; Name = $proc.Name; CommandLine = (Get-WmiObject Win32_Process -Filter "ProcessId=$procId" -ErrorAction SilentlyContinue).CommandLine }
  } catch {
    return @{ PID = $procId; Name = 'unknown'; CommandLine = 'unknown' }
  }
}

function Write-PidFile([string]$path, [int]$procId) {
  $procId | Out-File -FilePath $path -NoNewline
}

function Read-PidFile([string]$path) {
  if (-not (Test-Path $path)) { return $null }
  try {
    $procId = [int](Get-Content $path -Raw).Trim()
    return $procId
  } catch { return $null }
}

function Remove-PidFile([string]$path) {
  if (Test-Path $path) { Remove-Item $path -Force }
}

function Test-ProcessAlive([int]$procId) {
  try { return (Get-Process -Id $procId -ErrorAction SilentlyContinue) -ne $null }
  catch { return $false }
}

function Stop-ManagedProcess([string]$pidFile, [string]$label) {
  $procId = Read-PidFile $pidFile
  if (-not $procId) { Write-Host "$label not running (no PID file)" -ForegroundColor DarkGray; return }
  if (-not (Test-ProcessAlive $procId)) { Write-Host "$label PID $procId already exited" -ForegroundColor DarkGray; Remove-PidFile $pidFile; return }
  Write-Host "Stopping $label (PID $procId)..." -ForegroundColor Yellow
  Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
  Start-Sleep -Milliseconds 500
  Remove-PidFile $pidFile
  Write-Host "$label stopped" -ForegroundColor Green
}

function Invoke-HealthCheck([int]$port) {
  try {
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/health" -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    return @{ StatusCode = $response.StatusCode; Body = ($response.Content | ConvertFrom-Json) }
  } catch {
    return @{ StatusCode = 0; Error = $_.Exception.Message }
  }
}

function Invoke-AuthCheck([int]$port, [string]$devUserId) {
  try {
    $headers = @{ 'X-User-Id' = $devUserId }
    $response = Invoke-WebRequest -Uri "http://127.0.0.1:$port/colorings" -Headers $headers -TimeoutSec 5 -UseBasicParsing -ErrorAction Stop
    return @{ StatusCode = $response.StatusCode }
  } catch {
    if ($_.Exception.Response) {
      return @{ StatusCode = [int]$_.Exception.Response.StatusCode }
    }
    return @{ StatusCode = 0; Error = $_.Exception.Message }
  }
}

function Get-LanIPv4 {
  $adapters = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue |
    Where-Object { $_.IPAddress -ne '127.0.0.1' -and $_.PrefixOrigin -ne 'WellKnown' } |
    Sort-Object { $_.InterfaceMetric }
  if ($adapters) { return $adapters[0].IPAddress }
  return $null
}

function Show-LogTail([string]$logFile, [int]$lines = 8) {
  if (-not (Test-Path $logFile)) { return }
  Write-Host "Last $lines lines of $(Split-Path -Leaf $logFile):" -ForegroundColor DarkGray
  Get-Content $logFile -Tail $lines | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
}

function Start-ManagedProcess([string]$label, [string]$workingDir, [string]$command, [string]$pidFile, [string]$logFile) {
  Write-Host "Starting $label..." -ForegroundColor Cyan
  $fullCommand = "$command 2>&1"
  $proc = Start-Process -FilePath 'cmd.exe' `
    -ArgumentList '/d', '/s', '/c', $fullCommand `
    -WorkingDirectory $workingDir `
    -WindowStyle Hidden `
    -PassThru `
    -RedirectStandardOutput $logFile

  Write-PidFile $pidFile $proc.Id
  Write-Host "$label started (PID $($proc.Id))" -ForegroundColor Green
  return $proc
}

function Wait-ForPort([int]$port, [int]$timeoutSeconds = 20) {
  $deadline = (Get-Date).AddSeconds($timeoutSeconds)
  while (-not (Test-ListeningPort $port) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 400
  }
  return Test-ListeningPort $port
}

# ═══════════════════════════════════════════════════════════════════════
# Status
# ═══════════════════════════════════════════════════════════════════════

function Show-Status {
  Write-Banner
  Write-Host 'STATUS' -ForegroundColor Cyan
  Write-Host '------' -ForegroundColor Cyan

  $apiPid = Read-PidFile $apiPidFile
  $vitePid = Read-PidFile $vitePidFile
  $cfPid = Read-PidFile $cloudflaredPidFile

  Write-Host "API PID:     $(if ($apiPid) { $apiPid } else { '-' })"
  Write-Host "Vite PID:    $(if ($vitePid) { $vitePid } else { '-' })"
  if ($cfPid) { Write-Host "Cloudflared PID: $cfPid" }

  if (Test-ListeningPort $apiPort) {
    $health = Invoke-HealthCheck $apiPort
    Write-Host "API /health: $(if ($health.StatusCode -eq 200) { '200 OK' } else { 'FAIL' })"
  } else {
    Write-Host 'API /health: not listening' -ForegroundColor Red
  }

  if (Test-ListeningPort $apiPort) {
    $envVars = Read-EnvLocal
    $devUser = Get-EnvValueOrDefault $envVars 'VITE_DEV_USER_ID' 'user_pixelhunter'
    $authCheck = Invoke-AuthCheck $apiPort $devUser
    Write-Host "API /colorings (X-User-Id): $(if ($authCheck.StatusCode -eq 200) { '200 OK' } elseif ($authCheck.StatusCode -eq 401) { '401 (dev auth disabled?)' } else { "$($authCheck.StatusCode)" })"
  }

  if (Test-ListeningPort $vitePort) {
    Write-Host "Vite:        http://127.0.0.1:$vitePort/" -ForegroundColor Green
  } else {
    Write-Host 'Vite:        not listening' -ForegroundColor Red
  }

  try {
    $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
    if ($tailscale) {
      $tsStatus = & $tailscale.Source serve status --json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
      if ($tsStatus -and $tsStatus.Web) {
        $tsUrls = @($tsStatus.Web.PSObject.Properties | Where-Object { $_.Value -match 'localhost:5173' })
        if ($tsUrls) { Write-Host "Tailscale:   $($tsStatus.Self.DNSName.TrimEnd('.'))" -ForegroundColor Cyan }
      }
    }
  } catch { }

  try {
    if ($cfPid -and (Test-ProcessAlive $cfPid)) {
      $match = Select-String -Path $cloudflaredLogFile -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue | Select-Object -Last 1
      if ($match) { Write-Host "Cloudflare:  $($match.Matches[-1].Value)/" -ForegroundColor Magenta }
    }
  } catch { }

  Write-Host ''
  Write-Host "Logs:" -ForegroundColor DarkGray
  Write-Host "  API : $apiLogFile" -ForegroundColor DarkGray
  Write-Host "  Vite: $viteLogFile" -ForegroundColor DarkGray
  Write-Host "  CF  : $cloudflaredLogFile" -ForegroundColor DarkGray
  Write-Host ''
}

# ═══════════════════════════════════════════════════════════════════════
# Stop
# ═══════════════════════════════════════════════════════════════════════

function Invoke-Stop {
  Write-Banner
  Write-Host 'STOPPING all launcher-managed processes...' -ForegroundColor Yellow
  Stop-ManagedProcess $apiPidFile 'API'
  Stop-ManagedProcess $vitePidFile 'Vite'
  Stop-ManagedProcess $cloudflaredPidFile 'Cloudflared'
  Write-Host 'Done.' -ForegroundColor Green
}

# ═══════════════════════════════════════════════════════════════════════
# Port conflict check
# ═══════════════════════════════════════════════════════════════════════

function Assert-PortFree([int]$port, [string]$label) {
  if (-not (Test-ListeningPort $port)) { return }
  $owner = Get-PortOwner $port
  if (-not $owner) { return }

  $managedPid = if ($port -eq $apiPort) { Read-PidFile $apiPidFile } elseif ($port -eq $vitePort) { Read-PidFile $vitePidFile } else { $null }

  if ($managedPid -and $owner.PID -eq $managedPid) {
    Write-Host "$label port $port is occupied by launcher-managed process (PID $($owner.PID))." -ForegroundColor Yellow
    Write-Host 'Use -Restart to restart it.' -ForegroundColor Yellow
    exit 1
  }

  Write-Warning "$label port $port is occupied by an unknown process:"
  Write-Host "  PID:  $($owner.PID)" -ForegroundColor DarkGray
  Write-Host "  Name: $($owner.Name)" -ForegroundColor DarkGray
  Write-Host "  Cmd:  $($owner.CommandLine)" -ForegroundColor DarkGray
  Write-Host 'Will NOT kill it automatically. Free the port first or use -Restart.' -ForegroundColor Yellow
  exit 1
}

# ═══════════════════════════════════════════════════════════════════════
# API check (health + auth)
# ═══════════════════════════════════════════════════════════════════════

function Test-ApiReady([string]$devUserId) {
  if (-not (Test-ListeningPort $apiPort)) { return $false }

  $health = Invoke-HealthCheck $apiPort
  if ($health.StatusCode -ne 200) {
    Write-Warning 'API /health returned non-200'
    Show-LogTail $apiLogFile
    return $false
  }

  $auth = Invoke-AuthCheck $apiPort $devUserId
  if ($auth.StatusCode -eq 401) {
    Write-Warning 'API is running but returns 401 on /colorings'
    Write-Warning 'Check that ALLOW_DEV_AUTH=true is set in .env.local'
    Write-Warning 'Restart the server with correct settings.'
    return $false
  }

  if ($auth.StatusCode -ne 200) {
    Write-Warning "API /colorings returned $($auth.StatusCode)"
    Show-LogTail $apiLogFile
    return $false
  }

  return $true
}

# ═══════════════════════════════════════════════════════════════════════
# Start commands
# ═══════════════════════════════════════════════════════════════════════

function Start-Api {
  $apiCommand = 'npm.cmd run dev:local'
  Start-ManagedProcess 'API' (Join-Path $projectRoot 'server') $apiCommand $apiPidFile $apiLogFile
}

function Start-Vite([string[]]$hostFlags = @(), [string]$additionalAllowedHosts = '') {
  $envBlock = ''
  if ($additionalAllowedHosts) {
    $envBlock = "set __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS=$additionalAllowedHosts && "
  }
  $hostArg = if ($hostFlags.Count -gt 0) { " $($hostFlags -join ' ')" } else { '' }
  $viteCommand = "${envBlock}npm.cmd run dev --$hostArg"
  Start-ManagedProcess 'Vite' $projectRoot $viteCommand $vitePidFile $viteLogFile
}

function Start-SplintLocal([bool]$openBrowser = $true) {
  Assert-PortFree $apiPort 'API'
  Assert-PortFree $vitePort 'Vite'

  Start-Api
  if (-not (Wait-ForPort $apiPort 20)) {
    Write-Error 'API did not start in time'
    Show-LogTail $apiLogFile
    exit 1
  }

  Start-Vite
  if (-not (Wait-ForPort $vitePort 20)) {
    Write-Error 'Vite did not start in time'
    Show-LogTail $viteLogFile
    exit 1
  }

  $envVars = Read-EnvLocal
  $devUser = Get-EnvValueOrDefault $envVars 'VITE_DEV_USER_ID' 'user_pixelhunter'
  Test-ApiReady $devUser | Out-Null

  $localUrl = "http://127.0.0.1:$vitePort/"
  Write-Host "Local: $localUrl" -ForegroundColor Green
  if ($openBrowser) { Start-Process $localUrl }
  return $localUrl
}

function Start-SplintLan {
  Assert-PortFree $apiPort 'API'
  Assert-PortFree $vitePort 'Vite'

  Start-Api
  if (-not (Wait-ForPort $apiPort 20)) {
    Write-Error 'API did not start in time'
    Show-LogTail $apiLogFile
    exit 1
  }

  Start-Vite -hostFlags @('--host', '0.0.0.0')
  if (-not (Wait-ForPort $vitePort 20)) {
    Write-Error 'Vite did not start in time'
    Show-LogTail $viteLogFile
    exit 1
  }

  $envVars = Read-EnvLocal
  $devUser = Get-EnvValueOrDefault $envVars 'VITE_DEV_USER_ID' 'user_pixelhunter'
  Test-ApiReady $devUser | Out-Null

  $lanIp = Get-LanIPv4
  if ($lanIp) {
    Write-Host "LAN URL (for phone/tablet): http://$($lanIp):$vitePort/" -ForegroundColor Cyan
    Write-Host "IMPORTANT: Make sure your phone is on the same Wi-Fi network." -ForegroundColor Yellow
  } else {
    Write-Warning 'Could not detect LAN IPv4 address'
  }

  Write-Host ''
  Write-Host 'Note: Windows Firewall may need a rule to allow port 5173.' -ForegroundColor DarkGray
  Write-Host 'The script will NOT open the firewall automatically.' -ForegroundColor DarkGray
  Write-Host 'To allow manually: netsh advfirewall firewall add rule name="Splint Vite" dir=in action=allow protocol=TCP localport=5173' -ForegroundColor DarkGray
}

function Start-SplintTailscale {
  $tailscale = Get-Command tailscale.exe -ErrorAction SilentlyContinue
  if (-not $tailscale) { Write-Error 'tailscale.exe not found in PATH'; exit 1 }

  $tsStatus = & $tailscale.Source status --json 2>$null | ConvertFrom-Json
  if (-not $tsStatus -or -not $tsStatus.Self.DNSName) {
    Write-Error 'Could not get Tailscale DNS name. Is Tailscale connected?'
    exit 1
  }

  $tsHostname = $tsStatus.Self.DNSName.TrimEnd('.')

  Assert-PortFree $apiPort 'API'
  Assert-PortFree $vitePort 'Vite'

  Start-Api
  if (-not (Wait-ForPort $apiPort 20)) {
    Write-Error 'API did not start in time'
    Show-LogTail $apiLogFile
    exit 1
  }

  Start-Vite -additionalAllowedHosts $tsHostname
  if (-not (Wait-ForPort $vitePort 20)) {
    Write-Error 'Vite did not start in time'
    Show-LogTail $viteLogFile
    exit 1
  }

  & $tailscale.Source serve --bg http://127.0.0.1:5173 | Out-Null
  Start-Sleep -Seconds 2

  $tsServeStatus = & $tailscale.Source serve status --json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue
  $tailscaleUrl = "https://$tsHostname/"
  Write-Host "Tailscale: $tailscaleUrl" -ForegroundColor Cyan

  if (-not $tsServeStatus -or -not $tsServeStatus.Web) {
    Write-Warning 'Tailscale serve may not be fully configured. Check: tailscale serve status'
  }
}

function Start-SplintCloudflare {
  $envVars = Read-EnvLocal
  $allowDevAuth = ($envVars['ALLOW_DEV_AUTH'] -eq 'true') -or ($envVars['VITE_ALLOW_DEV_AUTH'] -eq 'true')

  if ($allowDevAuth -and -not $UnsafePublicDevAuth) {
    Write-Host ''
    Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Red
    Write-Host 'WARNING: DEV AUTH IS ENABLED + CLOUDFLARE TUNNEL IS PUBLIC' -ForegroundColor Red
    Write-Host '!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!' -ForegroundColor Red
    Write-Host ''
    Write-Host 'ALLOW_DEV_AUTH or VITE_ALLOW_DEV_AUTH is set to true.' -ForegroundColor Yellow
    Write-Host 'A Cloudflare Quick Tunnel exposes your dev server to the internet.' -ForegroundColor Yellow
    Write-Host 'Anyone with the URL can bypass authentication.' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'To proceed anyway, re-run with the -UnsafePublicDevAuth flag:' -ForegroundColor Yellow
    Write-Host '  launch-splint.bat cloudflare -UnsafePublicDevAuth' -ForegroundColor DarkGray
    Write-Host ''
    exit 1
  }

  $cloudflared = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
  if (-not $cloudflared) { Write-Error 'cloudflared.exe not found in PATH'; exit 1 }

  $possibleConfigs = @(
    (Join-Path $HOME '.cloudflared\config.yml'),
    (Join-Path $HOME '.cloudflared\config.yaml')
  )
  foreach ($cfg in $possibleConfigs) {
    if (Test-Path $cfg) {
      Write-Warning "Found cloudflared config: $cfg"
      Write-Warning 'Quick Tunnels may be incompatible with existing config.yml. If the tunnel fails, temporarily rename the config file.'
    }
  }

  try {
    Set-Content -Path $cloudflaredLogFile -Value '' -Force -ErrorAction Stop
  } catch {
    Write-Warning "Could not clear cloudflared log (file may be locked by a previous tunnel). Continuing..."
  }

  $cfProc = Start-Process -FilePath $cloudflared.Source `
    -ArgumentList 'tunnel', '--url', "http://127.0.0.1:$vitePort", '--no-autoupdate' `
    -WorkingDirectory $projectRoot `
    -WindowStyle Hidden `
    -RedirectStandardError $cloudflaredLogFile `
    -PassThru

  Write-PidFile $cloudflaredPidFile $cfProc.Id
  Write-Host "Cloudflared started (PID $($cfProc.Id))" -ForegroundColor Green

  $cloudflareUrl = $null
  $tunnelDeadline = (Get-Date).AddSeconds(25)
  while (-not $cloudflareUrl -and (Get-Date) -lt $tunnelDeadline) {
    Start-Sleep -Milliseconds 500
    $match = Select-String -Path $cloudflaredLogFile -Pattern 'https://[a-z0-9-]+\.trycloudflare\.com' -AllMatches -ErrorAction SilentlyContinue | Select-Object -Last 1
    if ($match) { $cloudflareUrl = $match.Matches[-1].Value + '/' }
  }

  if (-not $cloudflareUrl) {
    Write-Warning "Tunnel started (PID $($cfProc.Id)) but URL not found in: $cloudflaredLogFile"
    Show-LogTail $cloudflaredLogFile
    exit 1
  }

  $cfHostname = ($cloudflareUrl -replace '^https://', '' -replace '/$', '')

  Assert-PortFree $apiPort 'API'
  Assert-PortFree $vitePort 'Vite'

  Start-Api
  if (-not (Wait-ForPort $apiPort 20)) {
    Write-Error 'API did not start in time'
    Show-LogTail $apiLogFile
    exit 1
  }

  Start-Vite -additionalAllowedHosts $cfHostname
  if (-not (Wait-ForPort $vitePort 20)) {
    Write-Error 'Vite did not start in time'
    Show-LogTail $viteLogFile
    exit 1
  }

  Write-Host "Cloudflare: $cloudflareUrl" -ForegroundColor Magenta
}

function Start-SplintFull {
  Write-Host 'Starting Docker services...' -ForegroundColor Cyan

  $envVars = Read-EnvLocal
  $envArgs = @()
  foreach ($kv in $envVars.GetEnumerator()) {
    $envArgs += "-e"
    $envArgs += "$($kv.Key)=$($kv.Value)"
  }

  $hasDbUrl = -not [string]::IsNullOrEmpty($envVars['DATABASE_URL'])
  if (-not $hasDbUrl) {
    Write-Warning 'DATABASE_URL is not set in .env.local'
    Write-Warning 'The API will use SQLite. Docker PostgreSQL will be started but not connected.'
    Write-Warning 'Set DATABASE_URL=postgresql://splint:splint_dev_password@localhost:5432/splint to use PostgreSQL.'
  }

  $dockerArgs = @('compose', 'up', '-d')
  & docker @dockerArgs
  if ($LASTEXITCODE -ne 0) { Write-Error 'Docker compose failed'; exit 1 }

  Write-Host 'Waiting for PostgreSQL...' -ForegroundColor Cyan
  $pgDeadline = (Get-Date).AddSeconds(60)
  $pgReady = $false
  while (-not $pgReady -and (Get-Date) -lt $pgDeadline) {
    $pgReady = (docker compose ps postgres --format json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue).Health -eq 'healthy'
    if (-not $pgReady) { Start-Sleep -Seconds 2 }
  }
  if ($pgReady) { Write-Host 'PostgreSQL healthy' -ForegroundColor Green }
  else { Write-Warning 'PostgreSQL health check timed out' }

  Write-Host 'Waiting for MinIO...' -ForegroundColor Cyan
  $minioDeadline = (Get-Date).AddSeconds(60)
  $minioReady = $false
  while (-not $minioReady -and (Get-Date) -lt $minioDeadline) {
    $minioReady = (docker compose ps minio --format json 2>$null | ConvertFrom-Json -ErrorAction SilentlyContinue).Health -eq 'healthy'
    if (-not $minioReady) { Start-Sleep -Seconds 2 }
  }
  if ($minioReady) { Write-Host 'MinIO healthy' -ForegroundColor Green }
  else { Write-Warning 'MinIO health check timed out' }

  Start-SplintLocal -openBrowser $true
}

# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

Test-NodeVersion

$modeList = @()
if ($ModeArgs) {
  foreach ($arg in $ModeArgs) {
    $modeList += $arg.ToLowerInvariant()
  }
}
$interactive = $modeList.Count -eq 0

if ($interactive) {
  Write-Banner
  Write-Host 'Modes: local  lan  tailscale  cloudflare  full  status  stop'
  Write-Host ''
  $input = Read-Host 'Choose mode'
  if ($input) {
    $modeList = @($input -split '\s+' | ForEach-Object { $_.ToLowerInvariant() })
  } else {
    $modeList = @()
  }
}

if (-not $modeList.Count) {
  Write-Error 'No mode selected.'
  exit 1
}

$validModes = @('local', 'lan', 'tailscale', 'cloudflare', 'full', 'status', 'stop')
$invalid = $modeList | Where-Object { $_ -notin $validModes }
if ($invalid) {
  Write-Error "Unknown mode(s): $($invalid -join ', '). Valid: $($validModes -join ', ')"
  exit 1
}

if ($Restart) {
  Write-Host 'Restart requested - stopping managed processes first...' -ForegroundColor Yellow
  Invoke-Stop
}

$needEnv = $modeList | Where-Object { $_ -ne 'stop' -and $_ -ne 'status' }

foreach ($mode in $modeList) {
  switch ($mode) {
    'stop'    { Invoke-Stop; break }
    'status'  { Show-Status; break }
    'local'   { Start-SplintLocal; break }
    'lan'     { Start-SplintLan; break }
    'tailscale' { Start-SplintTailscale; break }
    'cloudflare' { Start-SplintCloudflare; break }
    'full'    { Start-SplintFull; break }
  }
}

if ($interactive -and $modeList -notcontains 'stop' -and $modeList -notcontains 'status') {
  Read-Host 'Ready. Press Enter to close this window' | Out-Null
}
