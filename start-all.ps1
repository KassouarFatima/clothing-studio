# Start (or restart) the three services of the clothing-studio app, fully detached:
# the processes belong to Windows itself, so they survive closing terminals,
# scripts and background jobs.
#   8792 = the walkable street world + Atelier shop (Yanis, Rin)
#   8080 = the studio backend (chat AI, image AI, handoff between the two sites)
#   5173 = the "Let'sDo it." design studio (Vite)
# Run from the project folder:
#   powershell -ExecutionPolicy Bypass -File .\start-all.ps1
$root = Split-Path -Parent $MyInvocation.MyCommand.Path

# Stop whatever is already listening on those ports (fresh, no duplicates).
foreach ($port in 8792, 8080, 5173) {
  $p = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  if ($p) { Stop-Process -Id $p -Force -ErrorAction SilentlyContinue; Start-Sleep -Milliseconds 400 }
}

# Fresh log for this run (a crash always leaves its reason behind).
$logA = Join-Path $root 'atelier\server.log'
$logS = Join-Path $root 'customizer\serveur\server.log'
$logV = Join-Path $root 'customizer\vite.log'
Remove-Item $logA, $logS, $logV -ErrorAction SilentlyContinue

$jobs = @(
  @{ dir = (Join-Path $root 'atelier');            log = $logA; run = 'node server.mjs';                     task = 'clothing-atelier' },
  @{ dir = (Join-Path $root 'customizer\serveur'); log = $logS; run = 'node index.js';                      task = 'clothing-serveur' },
  @{ dir = (Join-Path $root 'customizer');         log = $logV; run = 'node node_modules\vite\bin\vite.js'; task = 'clothing-vite' }
)
foreach ($job in $jobs) {
  $inner = "Set-Location -LiteralPath '$($job.dir)'; $($job.run) *>> '$($job.log)'"
  # -WindowStyle Hidden: services run WITHOUT a terminal window (a visible one used to
  # pop up for every start and crash-restart, piling windows on the desktop).
  $arg = "-NoProfile -WindowStyle Hidden -Command `"$inner`""
  # The service runs as a Windows SCHEDULED TASK: started by the Task Scheduler
  # itself, so it survives closed terminals, session restarts and even reboots
  # (the trigger re-arms at every logon), and it is restarted within a minute
  # if node ever crashes. Remove a task with:
  #   Unregister-ScheduledTask -TaskName 'clothing-atelier'   (or -serveur / -vite)
  $action   = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $arg
  $trigger  = New-ScheduledTaskTrigger -AtLogOn
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -ExecutionTimeLimit (New-TimeSpan -Days 999) -MultipleInstances IgnoreNew `
    -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1)
  try {
    Register-ScheduledTask -TaskName $job.task -Action $action -Trigger $trigger -Settings $settings -Force -ErrorAction Stop | Out-Null
    Start-ScheduledTask -TaskName $job.task
  } catch { # machines where task registration is restricted: detached process as before
    $made = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = "powershell.exe $arg" }
    if ($made.ReturnValue -ne 0) {
      # Last resort: hidden too, and the command is quoted by hand because
      # PowerShell 5.1 does not quote ArgumentList entries that contain spaces.
      Start-Process powershell -ArgumentList '-NoProfile', '-WindowStyle', 'Hidden', '-Command', ('"' + $inner + '"') -WindowStyle Hidden
    }
  }
}

# Verify every port answers (up to 15 s each).
$taskByPort = @{ 8792 = 'clothing-atelier'; 8080 = 'clothing-serveur'; 5173 = 'clothing-vite' }
foreach ($port in 8792, 8080, 5173) {
  $ok = $false
  for ($i = 0; $i -lt 30 -and -not $ok; $i++) {
    if ($i -eq 8) { Start-ScheduledTask -TaskName $taskByPort[$port] -ErrorAction SilentlyContinue } # stale instance race: nudge once
    if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) { $ok = $true } else { Start-Sleep -Milliseconds 500 }
  }
  $p = (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
  if ($ok) { Write-Host "port ${port}: OK (pid $p)" } else { Write-Host "port ${port}: DOWN - check the log files" }
}
Write-Host 'Ready. Open http://localhost:8792/ (the street) in your browser.'
