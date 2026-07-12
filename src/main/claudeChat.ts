import { WebContentsView, BrowserWindow, session, shell } from 'electron'
import { IPC, type ViewBounds, type ClaudeChatNavState, type ClaudeChatAuthHint } from '../shared/ipc'
import { attachEditContextMenu } from './contextMenu'

// Standard Chrome UA — Electron's default UA includes "Electron/<version>",
// which Google's OAuth flow rejects outright with "disallowed_useragent"
// (§6.3). Version string doesn't need to track the real Chrome release;
// Google checks the browser family, not the exact build. This MUST be set
// at the session level (see claudeSession() below), not per-webContents —
// the OAuth popup is a separate webContents, and a per-load override never
// reaches it.
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const CLAUDE_URL = 'https://claude.ai'
const CLAUDE_PARTITION = 'persist:claude-chat'

// Hosts allowed to open as a real popup window sharing the claude-chat
// session (Google's OAuth flow, and claude.ai/anthropic.com's own
// popups/tabs). Everything else keeps the pre-existing external-link
// behavior. Subdomains match too (e.g. myaccount.google.com).
const AUTH_POPUP_HOSTS = ['accounts.google.com', 'claude.ai', 'anthropic.com']

// Markers seen on Google's own rejection pages — most notably
// "disallowed_useragent", which is exactly the failure mode this fix
// targets. Logged loudly and surfaced to the renderer so a user isn't just
// staring at a dead-end error page.
const AUTH_ERROR_MARKERS = ['disallowed_useragent', 'accounts.google.com/signin/rejected']

interface Session {
  view: WebContentsView
  win: BrowserWindow
  visible: boolean
}

const sessions = new Map<string, Session>()

/** Returns the shared claude.ai session, (re)asserting the Chrome UA on it.
 *  Setting the UA here — not on any individual webContents — is what makes
 *  the OAuth popup (a separate webContents, same session) inherit it too. */
function claudeSession(): Electron.Session {
  const s = session.fromPartition(CLAUDE_PARTITION)
  s.setUserAgent(CHROME_USER_AGENT)
  return s
}

function isAuthPopupUrl(url: string): boolean {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch {
    return false
  }
  return AUTH_POPUP_HOSTS.some((host) => hostname === host || hostname.endsWith(`.${host}`))
}

/** Logs Google's own "we don't like this browser" page and tells the tab to
 *  hint at email-code login instead, in case the UA/popup fixes above still
 *  aren't enough for some future Google-side check. */
function checkForAuthError(id: string, url: string, s: Session): void {
  if (!AUTH_ERROR_MARKERS.some((marker) => url.includes(marker))) return
  console.error(`[ShinShell] claude-chat auth error for tab ${id}: ${url}`)
  if (s.win.isDestroyed()) return
  const payload: ClaudeChatAuthHint = {
    id,
    message: 'Google sign-in was blocked here — try "Sign in with email" on claude.ai instead.'
  }
  s.win.webContents.send(IPC.claudeChatAuthHint, payload)
}

function pushNavState(id: string, session: Session): void {
  if (session.win.isDestroyed()) return
  const wc = session.view.webContents
  checkForAuthError(id, wc.getURL(), session)
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

  claudeSession()

  const view = new WebContentsView({
    webPreferences: {
      partition: CLAUDE_PARTITION,
      contextIsolation: true,
      sandbox: true
    }
  })
  attachEditContextMenu(view.webContents)

  const shinshellSession: Session = { view, win, visible: false }
  sessions.set(id, shinshellSession)

  // Google's sign-in flow opens as a popup (window.open), not a navigation
  // of the tab itself. Auth hosts get a real child BrowserWindow sharing
  // this same session partition (no partition override below, so it
  // inherits the opener's session — and with it, the UA from claudeSession()
  // above) so the auth result lands back in the tab. Everything else keeps
  // the pre-existing behavior: deny and hand off to the OS browser.
  view.webContents.setWindowOpenHandler(({ url }) => {
    if (isAuthPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 480,
          height: 720,
          parent: win,
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            sandbox: true
          }
        }
      }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  view.webContents.on('did-create-window', (childWindow) => {
    attachEditContextMenu(childWindow.webContents)
    const onPopupNav = (): void => checkForAuthError(id, childWindow.webContents.getURL(), shinshellSession)
    childWindow.webContents.on('did-navigate', onPopupNav)
    childWindow.webContents.on('did-navigate-in-page', onPopupNav)
    childWindow.webContents.on('did-fail-load', (_e, errorCode, errorDescription, validatedUrl) => {
      console.error(
        `[ShinShell] claude-chat OAuth popup failed to load (${errorCode} ${errorDescription}): ${validatedUrl}`
      )
    })
  })

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

/** Ensures the shared claude.ai session partition exists (with its UA set)
 *  before any view needs it — mainly so cookies/login persist identically
 *  regardless of which project window opens the first claude-chat tab. */
export function warmClaudeChatPartition(): void {
  claudeSession()
}
