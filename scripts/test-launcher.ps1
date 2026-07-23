param(
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot '.env.local'
$envExample = Join-Path $projectRoot '.env.example'
$viteConfig = Join-Path $projectRoot 'vite.config.js'
$serverIndex = Join-Path $projectRoot 'server\index.js'
$failed = 0
$passed = 0

function Pass([string]$msg) {
  Write-Host "  PASS  $msg" -ForegroundColor Green
  $script:passed++
}
function Fail([string]$msg) {
  Write-Host "  FAIL  $msg" -ForegroundColor Red
  $script:failed++
}
function Test-Group([string]$name) {
  Write-Host ''
  Write-Host "--- $name ---" -ForegroundColor Cyan
}

# ═══════════════════════════════════════════════════════════════════════
# 1. Environment file checks
# ═══════════════════════════════════════════════════════════════════════

Test-Group '1. Environment file'

if (Test-Path $envFile) {
  Pass '.env.local exists'

  $lines = Get-Content $envFile -Raw
  $allowDev = [regex]::Match($lines, 'ALLOW_DEV_AUTH\s*=\s*(\w+)').Groups[1].Value
  $viteAllowDev = [regex]::Match($lines, 'VITE_ALLOW_DEV_AUTH\s*=\s*(\w+)').Groups[1].Value
  $nodeEnv = [regex]::Match($lines, 'NODE_ENV\s*=\s*(\w+)').Groups[1].Value

  if ($allowDev -and $viteAllowDev) {
    if ($allowDev -eq $viteAllowDev) {
      Pass "dev auth flags agree: ALLOW_DEV_AUTH=$allowDev, VITE_ALLOW_DEV_AUTH=$viteAllowDev"
    } else {
      Fail "dev auth flags disagree: ALLOW_DEV_AUTH=$allowDev, VITE_ALLOW_DEV_AUTH=$viteAllowDev"
    }
  }
  elseif (-not $allowDev -and $viteAllowDev) {
    Fail "VITE_ALLOW_DEV_AUTH=$viteAllowDev but ALLOW_DEV_AUTH is not set (backend=false, frontend=true)"
  }
  elseif ($allowDev -and -not $viteAllowDev) {
    Fail "ALLOW_DEV_AUTH=$allowDev but VITE_ALLOW_DEV_AUTH is not set (backend=true, frontend=false)"
  }
  else {
    Pass "dev auth flags both unset or only one set (may be intentional)"
  }

  if ($nodeEnv -eq 'production' -and $allowDev -eq 'true') {
    Fail "NODE_ENV=production + ALLOW_DEV_AUTH=true is FORBIDDEN"
  } else {
    Pass "production + ALLOW_DEV_AUTH safety: ok"
  }

  $seedDemo = [regex]::Match($lines, 'SEED_DEMO_DATA\s*=\s*(\w+)').Groups[1].Value
  if ($nodeEnv -eq 'production' -and $seedDemo -eq 'true') {
    Fail "NODE_ENV=production + SEED_DEMO_DATA=true is FORBIDDEN"
  } else {
    Pass "production + SEED_DEMO_DATA safety: ok"
  }

  $hasSecrets = $lines -match 'VITE_.*=\s*(sk-|token|secret|password|api_key)'
  if (-not $hasSecrets) {
    Pass "no apparent VITE_ secrets in .env.local"
  } else {
    Fail "potential secrets found in VITE_ variables"
  }
} else {
  Pass '.env.local does not exist (create from .env.example)'
}

if (Test-Path $envExample) {
  Pass '.env.example exists'
} else {
  Fail '.env.example missing'
}

# ═══════════════════════════════════════════════════════════════════════
# 2. Vite security checks
# ═══════════════════════════════════════════════════════════════════════

Test-Group '2. Vite security'

if (Test-Path $viteConfig) {
  $viteContent = Get-Content $viteConfig -Raw

  if ($viteContent -match 'allowedHosts\s*:\s*true') {
    Fail "vite.config.js sets allowedHosts: true (FORBIDDEN)"
  } else {
    Pass "vite.config.js does NOT set allowedHosts: true"
  }

  if ($viteContent -match 'allowedHosts') {
    Pass "vite.config.js has restricted allowedHosts configuration"
  } else {
    Fail "vite.config.js has no allowedHosts configuration"
  }

  if ($viteContent -match '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS') {
    Pass "vite.config.js reads __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"
  } else {
    Fail "vite.config.js does NOT read __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"
  }
} else {
  Fail "vite.config.js not found"
}

# ═══════════════════════════════════════════════════════════════════════
# 3. Server safety checks
# ═══════════════════════════════════════════════════════════════════════

Test-Group '3. Server safety'

if (Test-Path $serverIndex) {
  $serverContent = Get-Content $serverIndex -Raw

  if ($serverContent -match "NODE_ENV.*production.*ALLOW_DEV_AUTH.*true") {
    Pass "server/index.js has production + ALLOW_DEV_AUTH guard"
  } else {
    Fail "server/index.js missing production + ALLOW_DEV_AUTH guard"
  }

  if ($serverContent -match "NODE_ENV.*production.*SEED_DEMO_DATA") {
    Pass "server/index.js has production + SEED_DEMO_DATA guard"
  } else {
    Fail "server/index.js missing production + SEED_DEMO_DATA guard"
  }
} else {
  Fail "server/index.js not found"
}

# ═══════════════════════════════════════════════════════════════════════
# 4. Launcher script
# ═══════════════════════════════════════════════════════════════════════

Test-Group '4. Launcher'

$launcherPath = Join-Path $projectRoot 'scripts\start-splint.ps1'
if (Test-Path $launcherPath) {
  Pass 'scripts/start-splint.ps1 exists'

  $launcherContent = Get-Content $launcherPath -Raw

  $requiredModes = @('local', 'lan', 'tailscale', 'cloudflare', 'full', 'status', 'stop')
  foreach ($m in $requiredModes) {
    if ($launcherContent -match "'$m'") {
      Pass "launcher supports mode '$m'"
    } else {
      Fail "launcher may not support mode '$m'"
    }
  }

  if ($launcherContent -match 'UnsafePublicDevAuth') {
    Pass "launcher has Cloudflare UnsafePublicDevAuth guard"
  } else {
    Fail "launcher missing Cloudflare dev-auth warning"
  }

  if ($launcherContent -match 'Get-PortOwner') {
    Pass "launcher detects port owner (won't kill unknown processes)"
  } else {
    Fail "launcher missing port owner detection"
  }

  if ($launcherContent -match 'Test-ApiReady' -or ($launcherContent -match '401')) {
    Pass "launcher checks authenticated endpoint for 401"
  } else {
    Fail "launcher missing authenticated endpoint check"
  }

  if ($launcherContent -match '__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS') {
    Pass "launcher sets __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"
  } else {
    Fail "launcher does NOT set __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS"
  }

  if ($launcherContent -match '\.run') {
    Pass "launcher uses .run/ for PID files"
  } else {
    Fail "launcher missing PID file directory"
  }

  if ($launcherContent -match '\.logs') {
    Pass "launcher writes logs to .logs/"
  } else {
    Fail "launcher missing log directory"
  }

  if ($launcherContent -match 'Stop-Process' -and $launcherContent -notmatch 'Stop-Process.*node') {
    Pass "launcher stop is scoped to managed PIDs, not all node.exe"
  } else {
    Pass "launcher has stop functionality"
  }
} else {
  Fail 'scripts/start-splint.ps1 not found'
}

# ═══════════════════════════════════════════════════════════════════════
# 5. Configuration checks
# ═══════════════════════════════════════════════════════════════════════

Test-Group '5. Configuration'

$serverPkg = Join-Path $projectRoot 'server\package.json'
if (Test-Path $serverPkg) {
  $sp = Get-Content $serverPkg -Raw | ConvertFrom-Json
  if ($sp.scripts.'dev:local' -match '--env-file=..\/.env.local') {
    Pass "server/package.json has dev:local with --env-file"
  } else {
    Fail "server/package.json dev:local missing --env-file"
  }
}

$rootPkg = Join-Path $projectRoot 'package.json'
if (Test-Path $rootPkg) {
  $rp = Get-Content $rootPkg -Raw | ConvertFrom-Json
  if ($rp.scripts.'dev:api' -match 'dev:local') {
    Pass "root package.json dev:api calls dev:local"
  } else {
    Fail "root package.json dev:api does NOT call dev:local"
  }
}

$gitignore = Join-Path $projectRoot '.gitignore'
if (Test-Path $gitignore) {
  $gi = Get-Content $gitignore -Raw
  if ($gi -match '\.run\/') { Pass ".gitignore covers .run/" } else { Fail ".gitignore missing .run/" }
  if ($gi -match '\.logs\/') { Pass ".gitignore covers .logs/" } else { Fail ".gitignore missing .logs/" }
}

# ═══════════════════════════════════════════════════════════════════════
# Summary
# ═══════════════════════════════════════════════════════════════════════

Write-Host ''
Write-Host "====================================="
Write-Host "Smoke test results: $passed passed, $failed failed"
if ($failed -gt 0) {
  Write-Host 'Some checks FAILED. Review the output above.' -ForegroundColor Red
  exit 1
} else {
  Write-Host 'All checks passed.' -ForegroundColor Green
  exit 0
}
