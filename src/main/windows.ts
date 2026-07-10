import { BrowserWindow, app, screen } from 'electron'
import { join } from 'path'
import { getProject, listProjects, recordSuccessfulOpen } from './projects'
import { validateProjectPath } from './projectValidation'
import { createAccentDotIcon } from './icon'
import { loadAppState, saveAppState, type WindowBounds } from './appState'
import { killPtysForWindow } from './pty'
import { destroyClaudeChatViewsForWindow } from './claudeChat'
import { unsubscribeSshHealth } from './sshHealth'
import { startWatching, stopWatching } from './watchSync'
import { attachEditContextMenu } from './contextMenu'
import { IPC } from '../shared/ipc'
import type { ProjectConfig } from '../shared/project'

const projectWindows = new Map<string, BrowserWindow>()
let launcherWindow: BrowserWindow | null = null
let lastFocusedProjectId: string | null = null

const MIN_WINDOW_WIDTH = 640
const MIN_WINDOW_HEIGHT = 480
const BOUNDS_SAVE_DEBOUNCE_MS = 500

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
  const state = loadAppState()
  saveAppState({ ...state, openProjectIds: [...projectWindows.keys()] })
}

/** True if `bounds` overlaps at least one currently-attached display — a
 *  saved position from a monitor that's since been unplugged (or a laptop
 *  undocked from an external display) shouldn't strand the window off-screen. */
function boundsOnAnyDisplay(bounds: WindowBounds): boolean {
  return screen.getAllDisplays().some((d) => {
    const db = d.bounds
    return (
      bounds.x < db.x + db.width &&
      bounds.x + bounds.width > db.x &&
      bounds.y < db.y + db.height &&
      bounds.y + bounds.height > db.y
    )
  })
}

function savedBoundsFor(key: string): WindowBounds | null {
  const saved = loadAppState().windowBounds?.[key]
  return saved && boundsOnAnyDisplay(saved) ? saved : null
}

/** Debounced save of the window's current position/size, and a re-fit
 *  broadcast (§ responsive resizing) whenever the window moves — possibly
 *  onto a monitor with a different DPI scale factor, which a CSS-driven
 *  ResizeObserver alone won't detect since the container's logical size
 *  doesn't change. */
function attachBoundsPersistence(win: BrowserWindow, key: string): void {
  let timer: ReturnType<typeof setTimeout> | null = null
  const save = (): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (win.isDestroyed()) return
      const state = loadAppState()
      saveAppState({ ...state, windowBounds: { ...state.windowBounds, [key]: win.getBounds() } })
    }, BOUNDS_SAVE_DEBOUNCE_MS)
  }
  win.on('resize', save)
  win.on('move', save)
  win.on('moved', () => win.webContents.send(IPC.windowDisplayChanged))
}

function baseWindowOptions(key: string, defaultWidth: number, defaultHeight: number): Electron.BrowserWindowConstructorOptions {
  const saved = savedBoundsFor(key)
  return {
    width: saved?.width ?? defaultWidth,
    height: saved?.height ?? defaultHeight,
    x: saved?.x,
    y: saved?.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
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

// Any display changing scale factor (dragging the window between
// mixed-DPI monitors, or Windows itself changing a display's scaling)
// re-fits every terminal in every open window so the prompt stays crisp.
// Electron's `screen` module is only usable after app ready, so this is
// called from index.ts's app.whenReady() handler rather than at module load.
export function watchDisplayChanges(): void {
  screen.on('display-metrics-changed', (_event, _display, changedMetrics) => {
    if (!changedMetrics.includes('scaleFactorChanged')) return
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send(IPC.windowDisplayChanged)
    }
  })
}

export function createLauncherWindow(): BrowserWindow {
  if (launcherWindow && !launcherWindow.isDestroyed()) {
    launcherWindow.focus()
    return launcherWindow
  }

  const win = new BrowserWindow(baseWindowOptions('launcher', 900, 640))
  attachBoundsPersistence(win, 'launcher')
  attachEditContextMenu(win.webContents)
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

  // § path validation — opening the window is never blocked by a missing
  // folder (a restored session with live terminals must still come back),
  // but a valid open is the moment we refresh the git-remote fingerprint
  // used for rename recovery later.
  if (validateProjectPath(config.workingDir).valid) recordSuccessfulOpen(projectId)

  const win = new BrowserWindow(baseWindowOptions(projectId, 1280, 800))
  attachBoundsPersistence(win, projectId)
  attachEditContextMenu(win.webContents)
  win.setTitle(config.name)
  win.setOverlayIcon(createAccentDotIcon(config.accentColor), config.name)
  win.once('ready-to-show', () => win.show())
  win.on('focus', () => {
    lastFocusedProjectId = projectId
  })
  win.on('closed', () => {
    killPtysForWindow(win.id)
    destroyClaudeChatViewsForWindow(win.id)
    unsubscribeSshHealth(projectId)
    stopWatching(projectId)
    projectWindows.delete(projectId)
    if (lastFocusedProjectId === projectId) lastFocusedProjectId = null
    persistOpenProjects()
  })

  loadWindow(win, `window=project&id=${encodeURIComponent(projectId)}`)
  projectWindows.set(projectId, win)
  persistOpenProjects()
  if (config.watchSync.enabled) startWatching(win, projectId)
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

/** After "Edit project details" saves, updates the OS-level chrome (title,
 *  taskbar accent dot) of that project's window if it's currently open, and
 *  pushes the fresh config to its renderer — no-op if the window isn't
 *  open, since the surface that made the edit already has its own copy. */
export function refreshProjectWindowChrome(projectId: string, config: ProjectConfig): void {
  const win = projectWindows.get(projectId)
  if (!win || win.isDestroyed()) return
  win.setTitle(config.name)
  win.setOverlayIcon(createAccentDotIcon(config.accentColor), config.name)
  win.webContents.send(IPC.projectsUpdated, config)
}

export function anyWindowOpen(): boolean {
  return BrowserWindow.getAllWindows().length > 0
}

export function getLastFocusedProjectWindow(): BrowserWindow | null {
  if (!lastFocusedProjectId) return null
  const win = projectWindows.get(lastFocusedProjectId)
  return win && !win.isDestroyed() ? win : null
}

/** § ShinShell Remote — reverse lookup so a pty session (which only knows
 *  its owning BrowserWindow's id, per pty.ts's Session) can be attributed
 *  to a project without new IPC plumbing: one BrowserWindow is always
 *  exactly one project. */
export function getProjectIdForWindow(windowId: number): string | undefined {
  for (const [projectId, win] of projectWindows) {
    if (win.id === windowId) return projectId
  }
  return undefined
}

/** § ShinShell Remote — GET /api/projects lists exactly the projects that
 *  currently have an open window, matching the desktop app's own notion of
 *  "open." */
export function listOpenProjectIds(): string[] {
  return [...projectWindows.keys()]
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
