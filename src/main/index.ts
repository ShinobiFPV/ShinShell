import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { IPC, type PtySpawnOptions, type SessionState } from '../shared/ipc'
import { spawnPty, writePty, resizePty, killPty, killAllPty } from './pty'
import { loadSession, saveSession } from './sessionStore'

function isDev(): boolean {
  return !app.isPackaged
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.once('ready-to-show', () => win.show())

  if (isDev() && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

function registerIpc(win: BrowserWindow): void {
  ipcMain.on(IPC.ptySpawn, (_event, opts: PtySpawnOptions) => spawnPty(win, opts))
  ipcMain.on(IPC.ptyWrite, (_event, id: string, data: string) => writePty(id, data))
  ipcMain.on(IPC.ptyResize, (_event, id: string, cols: number, rows: number) =>
    resizePty(id, cols, rows)
  )
  ipcMain.on(IPC.ptyKill, (_event, id: string) => killPty(id))

  ipcMain.handle(IPC.sessionLoad, () => loadSession())
  ipcMain.on(IPC.sessionSave, (_event, state: SessionState) => saveSession(state))
  ipcMain.handle(IPC.systemHomeDir, () => app.getPath('home'))
}

app.whenReady().then(() => {
  const win = createWindow()
  registerIpc(win)

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  killAllPty()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  killAllPty()
})
