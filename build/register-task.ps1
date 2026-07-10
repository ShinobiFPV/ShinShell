# Re-registers the "ShinShell" scheduled task on every install (fresh or
# reinstall/update) — see build/installer.nsh for why this task is the
# whole zero-UAC trick.
#
# It also relaunches via that task when this is a *reinstall/update* on a
# machine that's run ShinShell before (see $hasRunBefore below):
# electron-builder's own post-install "run after" launches the exe directly
# at normal (non-elevated) integrity even when isForceRunAfter is requested
# from an elevated silent install — verified live via electron-updater's
# auto-update flow, which is exactly the case this matters for. schtasks
# /run is the only launch path that's actually UAC-free (see README's
# Elevation section), so that's what relaunches the app post-update instead
# of electron-builder's default. A genuinely fresh install does NOT
# auto-launch — first-run still goes through the desktop/Start Menu
# shortcut like it always has.
param([Parameter(Mandatory=$true)][string]$ExePath)

# Whether to auto-relaunch after this install: NOT based on whether the
# scheduled task already exists — electron-builder's assisted NSIS flow
# silently uninstalls the previous version (running customUnInstall, i.e.
# unregister-task.ps1, which deletes the task) *before* customInstall runs
# on every reinstall, so the task is already gone by the time this script
# executes even on a machine that's run ShinShell for months. Verified live:
# that made $existed false on every real reinstall, not just fresh ones.
#
# %APPDATA%\ShinShell survives install/uninstall/reinstall untouched (it's
# never written by any install step, only by the running app), so its
# presence is the actual "has this app been used on this machine before"
# signal a fresh-install-vs-update distinction needs.
$hasRunBefore = Test-Path "$env:APPDATA\ShinShell\app-state.json"

$action = New-ScheduledTaskAction -Execute $ExePath
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest -LogonType Interactive
Register-ScheduledTask -TaskName "ShinShell" -Action $action -Principal $principal -Force | Out-Null

if ($hasRunBefore) {
  # -Wait: nsExec::ExecToLog (installer.nsh) waits for this script's own
  # process to exit before NSIS proceeds, which can tear down this script's
  # child process tree — an un-waited schtasks.exe risks getting killed
  # before it finishes telling Task Scheduler to start the task. schtasks
  # /run returns almost immediately regardless (it doesn't block on the
  # launched app finishing startup), so this adds negligible install time.
  Start-Process -FilePath "$env:WINDIR\System32\schtasks.exe" -ArgumentList '/run', '/tn', 'ShinShell' -Wait
}
