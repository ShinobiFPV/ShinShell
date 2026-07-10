# Re-registers the "ShinShell" scheduled task on every install (fresh or
# reinstall/update) — see build/installer.nsh for why this task is the
# whole zero-UAC trick.
#
# It also relaunches via that task when this is a *reinstall* (task already
# existed): electron-builder's own post-install "run after" launches the
# exe directly at normal (non-elevated) integrity even when isForceRunAfter
# is requested from an elevated silent install — verified live via
# electron-updater's auto-update flow, which is exactly the case this
# matters for. schtasks /run is the only launch path that's actually
# UAC-free (see README's Elevation section), so that's what relaunches the
# app post-update instead of electron-builder's default. A genuinely fresh
# install (no pre-existing task) does NOT auto-launch — first-run still
# goes through the desktop/Start Menu shortcut like it always has.
param([Parameter(Mandatory=$true)][string]$ExePath)
$existed = [bool](Get-ScheduledTask -TaskName "ShinShell" -ErrorAction SilentlyContinue)
$action = New-ScheduledTaskAction -Execute $ExePath
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest -LogonType Interactive
Register-ScheduledTask -TaskName "ShinShell" -Action $action -Principal $principal -Force | Out-Null
if ($existed) {
  Start-Process -FilePath "$env:WINDIR\System32\schtasks.exe" -ArgumentList '/run', '/tn', 'ShinShell'
}
