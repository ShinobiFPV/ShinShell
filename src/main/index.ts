import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { IPC, type PtySpawnOptions, type BackgroundCommandOptions, type ViewBounds } from '../shared/ipc'
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
  refreshProjectWindowChrome
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
import type { DeployRun } from '../shared/ipc'

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

app.whenReady().then(() => {
  registerIpc()
  warmClaudeChatPartition()
  watchDisplayChanges()
  logInvalidProjectPaths()
  restoreWindows()
  ensureScheduledTaskIfElevated()
  registerGlobalHotkeys()

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
})
