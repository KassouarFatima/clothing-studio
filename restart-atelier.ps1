# restart-atelier.ps1 - restarts the Atelier shop (port 8792) so it loads the latest code.
# Double-click "restart atelier" on the Desktop. The watchdog brings it back by itself in ~30 s.
param([switch]$NoPause)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
function Say($msg) { Write-Host $msg }
Say 'Restarting the Atelier (port 8792) to load the latest code...'
$wpid = $null
try { $wpid = (Get-NetTCPConnection -LocalPort 8792 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess } catch {}
$ok = $true
if ($wpid) {
  Stop-Process -Id $wpid -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  if (Get-NetTCPConnection -LocalPort 8792 -State Listen -ErrorAction SilentlyContinue) {
    & taskkill /F /PID $wpid 2>&1 | Out-Null
    Start-Sleep -Seconds 2
  }
  if (Get-NetTCPConnection -LocalPort 8792 -State Listen -ErrorAction SilentlyContinue) {
    $ok = $false
    Say 'The old Atelier process is protected and could not be stopped.'
    Say 'Please REBOOT the computer: everything restarts by itself with the new code.'
  } else {
    Say 'Old Atelier stopped.'
  }
} else {
  Say 'The Atelier was not running.'
}
if ($ok) {
  Say 'Waiting for the watchdog to bring it back (up to 40 s)...'
  for ($i = 0; $i -lt 40; $i++) {
    if (Get-NetTCPConnection -LocalPort 8792 -State Listen -ErrorAction SilentlyContinue) { break }
    Start-Sleep -Seconds 2
  }
  $up = $false
  try {
    $r = Invoke-WebRequest -Uri 'http://localhost:8792/' -UseBasicParsing -TimeoutSec 8
    if ($r.StatusCode -eq 200) { $up = $true }
  } catch {}
  if ($up) {
    Say 'The Atelier is back with the new code.'
    Say 'Now: hard-refresh the shop page (Ctrl+F5) and try your design again.'
  } else {
    Say 'It is still starting. Wait 30 s, hard-refresh (Ctrl+F5) and retry.'
    Say 'If it never comes back, double-click "clothing-studio services" on the Desktop.'
  }
}
if (-not $NoPause) { Read-Host 'Press Enter to close' }
