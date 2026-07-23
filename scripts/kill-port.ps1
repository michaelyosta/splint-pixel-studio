$connections = Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue
$found = $false
foreach ($c in $connections) {
  $ownerPid = $c.OwningProcess
  if ($ownerPid -and $ownerPid -gt 0) {
    Stop-Process -Id $ownerPid -Force -ErrorAction SilentlyContinue
    Write-Output "Killed process $ownerPid"
    $found = $true
  }
}
if (-not $found) {
  Write-Output "Nothing on port 5173"
}
