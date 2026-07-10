import { WebContentsView, BrowserWindow, session, shell } from 'electron'
import { IPC, type ViewBounds, type ClaudeChatNavState } from '../shared/ipc'
import { attachEditContextMenu } from './contextMenu'

// Standard Chrome UA — Electron's default UA includes "Electron/<version>",
// which Google's OAuth flow rejects outright (§6.3). Version string doesn't
// need to track the real Chrome release; Google checks the browser family,
// not the exact build.
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const CLAUDE_URL = 'https://claude.ai'

interface Session {
  view: WebContentsView
  win: BrowserWindow
  visible: boolean
}

const sessions = new Map<string, Session>()

function pushNavState(id: string, session: Session): void {
  if (session.win.isDestroyed()) return
  const wc = session.view.webContents
  const payload: ClaudeChatNavState = {
    id,
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
    title: wc.getTitle(),
    url: wc.getURL(),
    loading: wc.isLoading()
  }
  session.win.webContents.send(IPC.claudeChatNavState, payload)
}

export function createClaudeChatView(win: BrowserWindow, id: string): void {
  if (sessions.has(id)) return

  const view = new WebContentsView({
    webPreferences: {
      partition: 'persist:claude-chat',
      contextIsolation: true,
      sandbox: true
    }
  })
  view.webContents.setUserAgent(CHROME_USER_AGENT)
  attachEditContextMenu(view.webContents)

  // External links (anything not claude.ai itself) open in the OS default
  // browser instead of navigating the embedded view (§6.3).
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(CLAUDE_URL)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  const shinshellSession: Session = { view, win, visible: false }
  sessions.set(id, shinshellSession)

  const onNavChange = (): void => pushNavState(id, shinshellSession)
  view.webContents.on('did-navigate', onNavChange)
  view.webContents.on('did-navigate-in-page', onNavChange)
  view.webContents.on('page-title-updated', onNavChange)
  view.webContents.on('did-start-loading', onNavChange)
  view.webContents.on('did-stop-loading', onNavChange)

  view.webContents.loadURL(CLAUDE_URL)
}

export function setClaudeChatBounds(id: string, bounds: ViewBounds): void {
  sessions.get(id)?.view.setBounds(bounds)
}

export function setClaudeChatVisible(id: string, visible: boolean): void {
  const s = sessions.get(id)
  if (!s || s.win.isDestroyed()) return
  if (visible && !s.visible) {
    s.win.contentView.addChildView(s.view)
  } else if (!visible && s.visible) {
    s.win.contentView.removeChildView(s.view)
  }
  s.visible = visible
}

export function claudeChatBack(id: string): void {
  const wc = sessions.get(id)?.view.webContents
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack()
}

export function claudeChatForward(id: string): void {
  const wc = sessions.get(id)?.view.webContents
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward()
}

export function claudeChatReload(id: string): void {
  sessions.get(id)?.view.webContents.reload()
}

export function destroyClaudeChatView(id: string): void {
  const s = sessions.get(id)
  if (!s) return
  if (s.visible && !s.win.isDestroyed()) s.win.contentView.removeChildView(s.view)
  s.view.webContents.close()
  sessions.delete(id)
}

export function destroyClaudeChatViewsForWindow(windowId: number): void {
  for (const [id, s] of sessions) {
    if (s.win.id === windowId) {
      s.view.webContents.close()
      sessions.delete(id)
    }
  }
}

/** Ensures the shared claude.ai session partition exists before any view
 *  needs it — mainly so cookies/login persist identically regardless of
 *  which project window opens the first claude-chat tab. */
export function warmClaudeChatPartition(): void {
  session.fromPartition('persist:claude-chat')
}
