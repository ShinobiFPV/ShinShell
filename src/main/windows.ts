import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { getProject } from './projects'
import { createAccentDotIcon } from './icon'
import { loadAppState, saveAppState } from './appState'
import { killPtysForWindow } from './pty'

const projectWindows = new Map<string, BrowserWindow>()
let launcherWindow: BrowserWindow | null = null

function isDev(): boolean {
  return !app.isPackaged
}

function loadWindow(win: BrowserWindow, search: string): void {
  if (isDev() && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/?${search}`)
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'), { search })
  }
}

function persistOpenProjects(): void {
  saveAppState({ openProjectIds: [...projectWindows.keys()] })
}

function baseWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
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
  }
}

export function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.focus()
    return launcherWindow
  }

  const win = new BrowserWindow({ ...baseWindowOptions(), width: 900, height: 640 })
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    launcherWindow = null
  })
  loadWindow(win, 'window=launcher')
  launcherWindow = win
  return win
}

export function openProjectWindow(projectId: string): BrowserWindow | null {
  const existing = projectWindows.get(projectId)
  if (existing && !existing.isDestroyed()) {
    existing.focus()
    return existing
  }

  const config = getProject(projectId)
  if (!config) return null

  const win = new BrowserWindow(baseWindowOptions())
  win.setTitle(config.name)
  win.setOverlayIcon(createAccentDotIcon(config.accentColor), config.name)
  win.once('ready-to-show', () => win.show())
  win.on('closed', () => {
    killPtysForWindow(win.id)
    projectWindows.delete(projectId)
    persistOpenProjects()
  })

  loadWindow(win, `window=project&id=${encodeURIComponent(projectId)}`)
  projectWindows.set(projectId, win)
  persistOpenProjects()
  return win
}

/** Reopen whatever project windows were open at last shutdown; if none (or first run), show the launcher. */
export function restoreWindows(): void {
  const { openProjectIds } = loadAppState()
  if (openProjectIds.length === 0) {
    createLauncherWindow()
    return
  }
  for (const id of openProjectIds) {
    openProjectWindow(id)
  }
}

export function anyWindowOpen(): boolean {
  return BrowserWindow.getAllWindows().length > 0
}
