import { BrowserWindow, app } from 'electron'
import { join } from 'path'
import { getProject, listProjects } from './projects'
import { createAccentDotIcon } from './icon'
import { loadAppState, saveAppState } from './appState'
import { killPtysForWindow } from './pty'

const projectWindows = new Map<string, BrowserWindow>()
let launcherWindow: BrowserWindow | null = null
let lastFocusedProjectId: string | null = null

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
  win.on('focus', () => {
    lastFocusedProjectId = projectId
  })
  win.on('closed', () => {
    killPtysForWindow(win.id)
    projectWindows.delete(projectId)
    if (lastFocusedProjectId === projectId) lastFocusedProjectId = null
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

export function getLastFocusedProjectWindow(): BrowserWindow | null {
  if (!lastFocusedProjectId) return null
  const win = projectWindows.get(lastFocusedProjectId)
  return win && !win.isDestroyed() ? win : null
}

export function getProjectIdByIndex(index: number): string | undefined {
  // 1-based, matches Ctrl+Alt+1..9 (§8) — ordering follows listProjects()'s
  // sort (by name), same order the launcher grid shows them in.
  return listProjects()[index - 1]?.id
}

/** Quake-style toggle (§6.9/§8 "summon/hide"): hide the last-focused project
 *  window if it's currently visible+focused, otherwise show and focus it.
 *  Falls back to the launcher if no project window has ever been focused. */
export function toggleSummon(): void {
  const win = getLastFocusedProjectWindow()
  if (!win) {
    createLauncherWindow()
    return
  }
  if (win.isVisible() && win.isFocused()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}
