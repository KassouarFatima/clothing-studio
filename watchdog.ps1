# watchdog.ps1 - keeps the three clothing-studio services running, always.
# Started automatically at every logon (shortcut in the Startup folder) and by
# the desktop shortcut "clothing-studio services". Every 30 seconds it checks
# the three ports; whatever is not listening gets re-spawned with a fresh log.
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$wlog = Join-Path $root 'watchdog.log'
# only ONE watchdog may run: a second one races the first into double-kills and double-spawns.
# Only short "-File ...watchdog.ps1" command lines count: a terminal or agent shell that merely
# MENTIONS the script (its whole command is the script text) must never count as a watchdog.
$others = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine.Length -lt 400 -and $_.CommandLine -like '*-File*watchdog.ps1*' }
if ($others) { exit }
$services = @(
  @{ port = 8792; dir = (Join-Path $root 'atelier');            run = 'node server.mjs';                     log = (Join-Path $root 'atelier\server.log');            src = (Join-Path $root 'atelier\server.mjs') },
  @{ port = 8080; dir = (Join-Path $root 'customizer\serveur'); run = 'node index.js';                      log = (Join-Path $root 'customizer\serveur\server.log'); src = (Join-Path $root 'customizer\serveur\index.js') },
  @{ port = 5173; dir = (Join-Path $root 'customizer');         run = 'node node_modules\vite\bin\vite.js'; log = (Join-Path $root 'customizer\vite.log');            src = (Join-Path $root 'customizer\vite.config.js') }
)
$lastStale = @{} # port -> when we last tried to recycle a service whose source file changed
function Note($msg) {
  try { Add-Content -LiteralPath $wlog -Value ('[' + (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + '] ' + $msg) -Encoding UTF8 } catch {}
}
Note 'watchdog started'
while ($true) {
  foreach ($s in $services) {
    if (-not (Get-NetTCPConnection -LocalPort $s.port -State Listen -ErrorAction SilentlyContinue)) {
      # cmd-style >> appends with shared access: a live service holding the log can never block a new spawn
      # (PowerShell's *>> opens it exclusively, which once killed every restart in a silent loop).
      # Start-Process -WindowStyle Hidden, NOT WMI: a WMI-created cmd opens a VISIBLE terminal
      # window on the desktop on every restart - one more window each time a service recycles.
      # The whole "/s /c ..." line is ONE pre-quoted string: that is exactly the command line
      # the old WMI spawn produced (which the services ran on for weeks) - PS 5.1 passes it verbatim.
      $inner = 'cd /d "' + $s.dir + '" && ' + $s.run + ' >> "' + $s.log + '" 2>&1'
      $made = Start-Process -FilePath 'cmd.exe' -ArgumentList ('/s /c "' + $inner + '"') -WindowStyle Hidden -PassThru -ErrorAction SilentlyContinue
      if ($made) { Note ("port " + $s.port + ' was down -> restarted (pid ' + $made.Id + ')') }
      else { Note ("port " + $s.port + ' was down -> spawn FAILED') }
      Start-Sleep -Seconds 4
    }
    elseif ($s.src -and (Test-Path -LiteralPath $s.src)) {
      # code changed on disk while the old server is still running: recycle it, or the new code never loads
      $wpid = $null; $started = $null; $written = $null
      try {
        $wpid = (Get-NetTCPConnection -LocalPort $s.port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess
        $started = (Get-Process -Id $wpid -ErrorAction SilentlyContinue).StartTime
        $written = (Get-Item -LiteralPath $s.src).LastWriteTime
      } catch {}
      if ($started -and $written -and $written -gt $started.AddSeconds(2)) {
        $due = (-not $lastStale.ContainsKey($s.port)) -or (((Get-Date) - $lastStale[$s.port]).TotalMinutes -ge 5)
        if ($due) {
          $lastStale[$s.port] = Get-Date
          Stop-Process -Id $wpid -Force -ErrorAction SilentlyContinue
          Start-Sleep -Seconds 2
          if (Get-NetTCPConnection -LocalPort $s.port -State Listen -ErrorAction SilentlyContinue) {
            Note ("port " + $s.port + ': code changed but the running process could not be stopped (protected) - a reboot will pick it up')
          } else {
            Note ("port " + $s.port + ': code file is newer than the running process -> restarting it')
          }
          Start-Sleep -Seconds 4
        }
      }
    }
  }
  Start-Sleep -Seconds 30
}
