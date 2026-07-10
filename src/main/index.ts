import { app, BrowserWindow, ipcMain, dialog, clipboard } from 'electron'
import QRCode from 'qrcode'
import {
  IPC,
  type PtySpawnOptions,
  type BackgroundCommandOptions,
  type ViewBounds,
  type RemoteDevice,
  type RemoteEnableResult
} from '../shared/ipc'
import type { ProjectRestoreState, ProjectUpdatePayload } from '../shared/project'
import { spawnPty, writePty, resizePty, killPty, killAllPty } from './pty'
import {
  listProjects,
  getProject,
  saveProjectRestoreState,
  createProjectFromFolder,
  validateProject,
  suggestFixes,
  updateProject
} from './projects'
import { isDirectory } from './projectValidation'
import {
  createLauncherWindow,
  openProjectWindow,
  restoreWindows,
  anyWindowOpen,
  watchDisplayChanges,
  refreshProjectWindowChrome,
  getLastFocusedProjectWindow
} from './windows'
import { isElevated, repairAndRelaunch, ensureScheduledTaskIfElevated } from './elevation'
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './globalHotkeys'
import { runBackgroundCommand } from './commands'
import {
  createClaudeChatView,
  setClaudeChatBounds,
  setClaudeChatVisible,
  claudeChatBack,
  claudeChatForward,
  claudeChatReload,
  destroyClaudeChatView,
  warmClaudeChatPartition
} from './claudeChat'
import { readFile, writeFile, showOpenFileDialog, showSaveFileDialog, showOpenFolderDialog } from './files'
import { loadScratchpad, saveScratchpad } from './scratchpad'
import { getDeployHistory, appendDeployRun } from './deployHistory'
import { subscribeSshHealth, unsubscribeSshHealth } from './sshHealth'
import { listListeningPorts, killProcess } from './ports'
import { getGitStatus } from './gitStatus'
import { getActivity, setWatchSyncEnabled } from './watchSync'
import { initAutoUpdater, checkForUpdates } from './updater'
import type { DeployRun } from '../shared/ipc'
import { startRemoteServer, stopRemoteServer, getRemoteStatus, sendTestNotification } from './remote/server'
import { generatePin, revokeDevice } from './remote/pairing'
import { loadRemoteState, saveRemoteState } from './remote/state'
import { installApplicationMenu } from './menu'
import { loadSettings, saveSettings } from './settings'

// "ShinShell" (not the lowercase package.json name) so userData resolves to
// %APPDATA%/ShinShell/, matching the path documented in SHINSHELL_SPEC.md §3.
app.setName('ShinShell')

function registerIpc(): void {
  ipcMain.on(IPC.ptySpawn, (event, opts: PtySpawnOptions) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) spawnPty(win, opts)
  })
  ipcMain.on(IPC.ptyWrite, (_event, id: string, data: string) => writePty(id, data))
  ipcMain.on(IPC.ptyResize, (_event, id: string, cols: number, rows: number) =>
    resizePty(id, cols, rows)
  )
  ipcMain.on(IPC.ptyKill, (_event, id: string) => killPty(id))

  ipcMain.handle(IPC.systemHomeDir, () => app.getPath('home'))
  ipcMain.handle(IPC.systemIsElevated, () => isElevated())
  ipcMain.on(IPC.systemRepair, () => repairAndRelaunch())

  ipcMain.handle(IPC.projectsList, () => listProjects())
  ipcMain.handle(IPC.projectsGet, (_event, id: string) => getProject(id))
  ipcMain.on(IPC.projectsSaveRestoreState, (_event, id: string, restore: ProjectRestoreState) =>
    saveProjectRestoreState(id, restore)
  )
  ipcMain.handle(IPC.projectsCreateFromFolder, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      properties: ['openDirectory'],
      title: 'Open Project Folder'
    }
    const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
    if (result.canceled || result.filePaths.length === 0) return null
    // Simple deterministic accent so repeat imports aren't all identical;
    // full accent-picker UI is a later-milestone concern (§6.2 "create/edit
    // projects in-app").
    const palette = ['#33FF66', '#FF8000', '#E10600', '#00B8D9', '#B14EFF', '#FFD400']
    const accentColor = palette[listProjects().length % palette.length]
    return createProjectFromFolder(result.filePaths[0], accentColor)
  })

  // § path validation + edit-project-details
  ipcMain.handle(IPC.projectsValidate, (_event, id: string) => validateProject(id))
  ipcMain.handle(IPC.projectsSuggestFixes, (_event, id: string) => suggestFixes(id))
  ipcMain.handle(IPC.projectsUpdate, (_event, payload: ProjectUpdatePayload) => {
    const updated = updateProject(payload)
    refreshProjectWindowChrome(payload.id, updated)
    return updated
  })

  ipcMain.on(IPC.windowOpenProject, (_event, id: string) => openProjectWindow(id))
  ipcMain.on(IPC.windowOpenLauncher, () => createLauncherWindow())

  // §UX3 — outcome feedback: taskbar progress while a run is active (2 =
  // indeterminate, duration unknown ahead of time) and a brief taskbar flash
  // on completion, so a deploy result doesn't require tabbing back to see.
  ipcMain.on(IPC.windowSetProgress, (event, progress: number | null) => {
    BrowserWindow.fromWebContents(event.sender)?.setProgressBar(progress ?? -1)
  })
  ipcMain.on(IPC.windowFlash, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.flashFrame(true)
  })

  ipcMain.on(IPC.commandsRunBackground, (_event, opts: BackgroundCommandOptions) =>
    runBackgroundCommand(opts)
  )

  ipcMain.on(IPC.claudeChatCreate, (event, id: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) createClaudeChatView(win, id)
  })
  ipcMain.on(IPC.claudeChatSetBounds, (_event, id: string, bounds: ViewBounds) =>
    setClaudeChatBounds(id, bounds)
  )
  ipcMain.on(IPC.claudeChatSetVisible, (_event, id: string, visible: boolean) =>
    setClaudeChatVisible(id, visible)
  )
  ipcMain.on(IPC.claudeChatBack, (_event, id: string) => claudeChatBack(id))
  ipcMain.on(IPC.claudeChatForward, (_event, id: string) => claudeChatForward(id))
  ipcMain.on(IPC.claudeChatReload, (_event, id: string) => claudeChatReload(id))
  ipcMain.on(IPC.claudeChatDestroy, (_event, id: string) => destroyClaudeChatView(id))

  ipcMain.handle(IPC.filesRead, (_event, path: string) => readFile(path))
  ipcMain.on(IPC.filesWrite, (_event, path: string, content: string) => writeFile(path, content))
  ipcMain.handle(IPC.filesShowOpenDialog, (event, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return showOpenFileDialog(win, defaultPath)
  })
  ipcMain.handle(IPC.filesShowSaveDialog, (event, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return showSaveFileDialog(win, defaultPath)
  })
  ipcMain.handle(IPC.filesShowOpenFolderDialog, (event, defaultPath?: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return showOpenFolderDialog(win, defaultPath)
  })
  ipcMain.handle(IPC.filesPathIsDirectory, (_event, path: string) => isDirectory(path))

  ipcMain.handle(IPC.scratchpadLoad, (_event, projectId: string) => loadScratchpad(projectId))
  ipcMain.on(IPC.scratchpadSave, (_event, projectId: string, content: string) =>
    saveScratchpad(projectId, content)
  )

  ipcMain.handle(IPC.deployHistoryGet, (_event, projectId: string) => getDeployHistory(projectId))
  ipcMain.on(IPC.deployHistoryAppend, (_event, projectId: string, run: DeployRun) =>
    appendDeployRun(projectId, run)
  )

  ipcMain.on(IPC.sshHealthSubscribe, (event, projectId: string) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) subscribeSshHealth(win, projectId)
  })
  ipcMain.on(IPC.sshHealthUnsubscribe, (_event, projectId: string) => unsubscribeSshHealth(projectId))

  ipcMain.handle(IPC.portsList, () => listListeningPorts())
  ipcMain.on(IPC.portsKill, (_event, pid: number) => killProcess(pid))

  ipcMain.handle(IPC.gitStatusGet, (_event, workingDir: string) => getGitStatus(workingDir))

  ipcMain.on(IPC.watchSyncSetEnabled, (event, projectId: string, enabled: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) setWatchSyncEnabled(win, projectId, enabled)
  })
  ipcMain.handle(IPC.watchSyncGetActivity, (_event, projectId: string) => getActivity(projectId))

  // § update check — the command palette's "Check for updates" entry.
  ipcMain.on(IPC.updaterCheck, () => checkForUpdates(true))

  // § ShinShell Remote
  ipcMain.handle(IPC.remoteGetStatus, () => getRemoteStatus())
  ipcMain.handle(IPC.remoteSetEnabled, async (_event, enabled: boolean): Promise<RemoteEnableResult> => {
    if (enabled) {
      const result = await startRemoteServer()
      broadcastRemoteStatus()
      return { ok: result.ok, error: result.error, status: getRemoteStatus() }
    }
    stopRemoteServer()
    const state = loadRemoteState()
    state.enabled = false
    saveRemoteState(state)
    broadcastRemoteStatus()
    return { ok: true, status: getRemoteStatus() }
  })
  ipcMain.handle(IPC.remoteGeneratePairingPin, () => {
    generatePin()
    broadcastRemoteStatus()
    return getRemoteStatus()
  })
  ipcMain.handle(IPC.remoteGetPairedDevices, (): RemoteDevice[] =>
    loadRemoteState().devices.map((d) => ({
      id: d.id,
      name: d.name,
      pairedAt: d.pairedAt,
      lastSeenAt: d.lastSeenAt,
      hasPushSubscription: Boolean(d.pushSubscription)
    }))
  )
  ipcMain.on(IPC.remoteRevokeDevice, (_event, id: string) => {
    revokeDevice(id)
    broadcastRemoteStatus()
  })
  ipcMain.on(IPC.remoteSetAllowFullInput, (_event, allow: boolean) => {
    const state = loadRemoteState()
    state.allowFullTerminalInput = allow
    saveRemoteState(state)
  })
  ipcMain.handle(IPC.remoteTestNotification, () => sendTestNotification())
  ipcMain.handle(IPC.remoteGetQrDataUrl, async (): Promise<string | null> => {
    const status = getRemoteStatus()
    return status.url ? QRCode.toDataURL(status.url) : null
  })

  // § clipboard fix — renderer has no direct `electron` access
  // (contextIsolation), so clipboard reads/writes round-trip through here.
  ipcMain.handle(IPC.clipboardReadText, () => clipboard.readText())
  ipcMain.on(IPC.clipboardWriteText, (_event, text: string) => clipboard.writeText(text))

  ipcMain.handle(IPC.settingsGet, () => loadSettings())
  ipcMain.on(IPC.settingsSetSkipMultilinePasteGuard, (_event, skip: boolean) => {
    const settings = loadSettings()
    settings.skipMultilinePasteGuard = skip
    saveSettings(settings)
  })
}

/** § ShinShell Remote — pushed to every open window (the launcher owns the
 *  visible badge/settings panel, but a project window's badge — if it ever
 *  gets one — should stay in sync too) whenever enable state, pairing, or
 *  device-list changes. */
function broadcastRemoteStatus(): void {
  const status = getRemoteStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.remoteStatus, status)
  }
}

// § path validation layer — checked on app launch for every registered
// project (this loop), on each window open (windows.ts), and before any
// action that uses the path (pty.ts, commands.ts, watchSync.ts). Log-only
// here: there's no UI to point at yet this early, the launcher/project
// windows do their own validate() calls once mounted.
function logInvalidProjectPaths(): void {
  for (const project of listProjects()) {
    const validation = validateProject(project.id)
    if (!validation.valid) {
      console.warn(`[ShinShell] Project "${project.name}" (${project.id}) path invalid: ${validation.reason}`)
    }
  }
}

// § single-instance lock — register-task.ps1 can now relaunch the app
// itself after a reinstall/update (see updater.ts), so a second launch
// racing the first (two schtasks /run in quick succession, or a stray
// manual one on top of that) must surface the existing instance instead of
// spawning a competing one fighting over the same ptys/ports.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = getLastFocusedProjectWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    } else {
      createLauncherWindow()
    }
  })

  app.whenReady().then(() => {
    installApplicationMenu()
    registerIpc()
    warmClaudeChatPartition()
    watchDisplayChanges()
    logInvalidProjectPaths()
    restoreWindows()
    ensureScheduledTaskIfElevated()
    registerGlobalHotkeys()
    initAutoUpdater()
    initRemoteServer()

    app.on('activate', () => {
      if (!anyWindowOpen()) restoreWindows()
    })
  })

  app.on('window-all-closed', () => {
    killAllPty()
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('will-quit', () => {
    unregisterGlobalHotkeys()
  })

  app.on('before-quit', () => {
    killAllPty()
    stopRemoteServer()
  })
}

// § ShinShell Remote — auto-starts only if it was already enabled (the
// user's own choice persists across restarts, same as every other
// per-project toggle in this app); a failure here (Tailscale down at
// launch) is surfaced via RemoteStatus.error, not a crash or a dialog.
function initRemoteServer(): void {
  const state = loadRemoteState()
  if (!state.enabled) return
  startRemoteServer()
    .then((result) => {
      if (!result.ok) console.warn('[remote] failed to auto-start:', result.error)
    })
    .finally(broadcastRemoteStatus)
}
