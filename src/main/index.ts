import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { IPC, type PtySpawnOptions, type BackgroundCommandOptions } from '../shared/ipc'
import type { ProjectRestoreState } from '../shared/project'
import { spawnPty, writePty, resizePty, killPty, killAllPty } from './pty'
import { listProjects, getProject, saveProjectRestoreState, createProjectFromFolder } from './projects'
import { createLauncherWindow, openProjectWindow, restoreWindows, anyWindowOpen } from './windows'
import { isElevated, repairAndRelaunch, ensureScheduledTaskIfElevated } from './elevation'
import { registerGlobalHotkeys, unregisterGlobalHotkeys } from './globalHotkeys'
import { runBackgroundCommand } from './commands'

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

  ipcMain.on(IPC.windowOpenProject, (_event, id: string) => openProjectWindow(id))
  ipcMain.on(IPC.windowOpenLauncher, () => createLauncherWindow())

  ipcMain.on(IPC.commandsRunBackground, (_event, opts: BackgroundCommandOptions) =>
    runBackgroundCommand(opts)
  )
}

app.whenReady().then(() => {
  registerIpc()
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
