; Custom NSIS hooks for ShinShell's zero-UAC-prompt elevation strategy
; (SHINSHELL_SPEC.md §5). electron-builder calls these macros during
; install/uninstall; APP_EXECUTABLE_FILENAME, INSTDIR, and BUILD_RESOURCES_DIR
; are provided by electron-builder's own NSIS template.
;
; The trick: a Scheduled Task with RunLevel=Highest, LogonType=Interactive
; can be started via `schtasks /run` with NO UAC prompt (Task Scheduler
; itself has authority to launch elevated processes without the interactive
; consent dialog). So the desktop/Start Menu shortcuts we create point at
; `schtasks.exe /run /tn ShinShell`, not directly at the exe — the exe's own
; manifest is "asInvoker" (see package.json), so a direct double-click would
; launch unelevated, which is exactly what lets the app's own runtime check
; (src/main/elevation.ts) detect that case and offer self-repair.
;
; The actual task-registration logic lives in register-task.ps1 /
; unregister-task.ps1 (plain files, extracted at install time) rather than
; inline PowerShell strings here — NSIS's own $ substitution collides with
; PowerShell's $variable/$env: syntax, and getting that nested escaping
; right for a whole script inline is exactly the kind of thing that looks
; fine in the source and silently no-ops at runtime (as an earlier version
; of this file did).

!macro customInstall
  File "/oname=$PLUGINSDIR\register-task.ps1" "${BUILD_RESOURCES_DIR}\register-task.ps1"
  DetailPrint "Registering ShinShell scheduled task (elevated, no-prompt launch)..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\register-task.ps1" -ExePath "$INSTDIR\${APP_EXECUTABLE_FILENAME}"'
  Pop $0
  DetailPrint "Scheduled task registration exit code: $0"

  DetailPrint "Creating shortcuts..."
  ; This is a perMachine install (SetShellVarContext defaults to "all"),
  ; which would otherwise resolve $DESKTOP to the shared Public Desktop —
  ; but "ShinTech Installs" is an existing per-user folder on the installing
  ; user's own Desktop (already holding e.g. ShinLink OS's shortcut), so the
  ; desktop shortcut specifically needs the "current" user context.
  SetShellVarContext current
  CreateDirectory "$DESKTOP\ShinTech Installs"
  CreateShortcut "$DESKTOP\ShinTech Installs\ShinShell.lnk" "$WINDIR\System32\schtasks.exe" "/run /tn ShinShell" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
  SetShellVarContext all
  CreateDirectory "$SMPROGRAMS\ShinShell"
  CreateShortcut "$SMPROGRAMS\ShinShell\ShinShell.lnk" "$WINDIR\System32\schtasks.exe" "/run /tn ShinShell" "$INSTDIR\${APP_EXECUTABLE_FILENAME}" 0
!macroend

!macro customUnInstall
  File "/oname=$PLUGINSDIR\unregister-task.ps1" "${BUILD_RESOURCES_DIR}\unregister-task.ps1"
  DetailPrint "Removing ShinShell scheduled task..."
  nsExec::ExecToLog 'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\unregister-task.ps1"'
  Pop $0

  SetShellVarContext current
  Delete "$DESKTOP\ShinTech Installs\ShinShell.lnk"
  RMDir "$DESKTOP\ShinTech Installs"
  SetShellVarContext all
  Delete "$SMPROGRAMS\ShinShell\ShinShell.lnk"
  RMDir "$SMPROGRAMS\ShinShell"
!macroend
