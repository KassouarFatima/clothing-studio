# fix-camera.ps1 — one-shot webcam unblock for "Your camera is busy..."
# Run AS ADMINISTRATOR:
#   right-click Start -> Windows PowerShell (admin), then paste:
#   powershell -ExecutionPolicy Bypass -File "C:\Users\Kassouar Fatima\Downloads\clothing-studio\fix-camera.ps1"

$ErrorActionPreference = 'Continue'

# 1) Restart the Camera Frame Server — Windows mediates ALL camera access through it,
#    and a stream that never released leaves it wedged (nobody can open the camera after).
Write-Output '[1/3] Restarting the Camera Frame Server service...'
$svc = Get-Service -Name FrameServer -ErrorAction SilentlyContinue
if ($svc) {
  Stop-Service -Name FrameServer -Force -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Start-Service -Name FrameServer -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 2
  Write-Output ('      FrameServer: ' + (Get-Service FrameServer).Status)
} else {
  Write-Output '      FrameServer service not found - skipping.'
}

# 2) Reset the webcam device itself — disable/enable drops every open handle,
#    so whatever is holding it is forced to let go.
Write-Output '[2/3] Resetting the webcam device...'
$cams = @(Get-PnpDevice -Class Camera,Image -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match 'Vision|Camera|Webcam' -and $_.Status -ne 'UNKNOWN' } |
  Sort-Object InstanceId -Unique)
if (-not $cams) { Write-Output '      No camera device found!' }
foreach ($c in $cams) {
  Write-Output ('      ' + $c.FriendlyName + ' (' + $c.Status + ') -> reset')
  Disable-PnpDevice -InstanceId $c.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
  Enable-PnpDevice -InstanceId $c.InstanceId -Confirm:$false -ErrorAction SilentlyContinue
  Start-Sleep -Seconds 3
}

# 3) Report final state.
Write-Output '[3/3] Final state:'
Get-PnpDevice -Class Camera,Image -ErrorAction SilentlyContinue |
  Where-Object { $_.FriendlyName -match 'Vision|Camera|Webcam' } |
  ForEach-Object { Write-Output ('      ' + $_.Status + ' | ' + $_.FriendlyName) }

Write-Output ''
Write-Output 'Done. Now:'
Write-Output '  1. Close EVERY browser tab/window that could see the camera'
Write-Output '     (Firefox, Edge, other Chrome tabs of the studio).'
Write-Output '  2. Open ONE fresh Chrome tab -> http://localhost:5173/'
Write-Output '     Ctrl+F5, open Wear it, press Try again.'
Write-Output 'If it still fails, open the Windows Camera app once and tell me'
Write-Output 'whether it shows your picture or an error message.'
