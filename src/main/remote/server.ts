// § ShinShell Remote — the HTTPS+WS server core. Off by default; only ever
// bound to the machine's Tailscale interface address, never 0.0.0.0 — that
// binding choice is the entire security boundary (a LAN-interface
// connection cannot reach a socket bound to a different local address), so
// nothing here should ever default `host` away.
import { createServer as createHttpsServer, type Server as HttpsServer } from 'https'
import { readFileSync, existsSync } from 'fs'
import { join, basename } from 'path'
import { hostname } from 'os'
import express, { type Request, type Response, type NextFunction } from 'express'
import { WebSocketServer, WebSocket } from 'ws'
import { app as electronApp } from 'electron'
import { getTailscaleSelf, issueCert, type TailscaleSelf } from './tailscale'
import { loadRemoteState, saveRemoteState, type PushSubscriptionJson, type QuietHours } from './state'
import { verifyToken, submitPin, type PairResult } from './pairing'
import { ensureVapid, getVapidPublicKey, notifyAllDevices } from './push'
import { getScrollback, getSessionMeta, listSessionIds, writePty, ptyEvents } from '../pty'
import { waitEvents, getStatus as getWaitStatus, getStateSince, type WaitStatus } from './waitDetector'
import { stripAnsi } from './ansi'
import { listOpenProjectIds, getProjectIdForWindow } from '../windows'
import { getProject } from '../projects'
import { getCachedHealth } from '../sshHealth'
import type { RemoteStatus, PtyDataEvent, PtyExitEvent, SshHealthStatus } from '../../shared/ipc'

const PORT = 8443
const CERT_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000
const AUTH_GRACE_MS = 5000

const KEY_BYTES: Record<string, string> = {
  enter: '\r',
  esc: '\x1b',
  up: '\x1b[A',
  down: '\x1b[B',
  y: 'y',
  n: 'n',
  'ctrl-c': '\x03'
}

interface Runtime {
  httpsServer: HttpsServer
  wss: WebSocketServer
  self: TailscaleSelf
  renewTimer: ReturnType<typeof setInterval>
}

interface ClientConn {
  ws: WebSocket
  deviceId: string | null
  subscriptions: Set<string>
  authTimer: ReturnType<typeof setTimeout> | null
}

let runtime: Runtime | null = null
let lastError: string | null = null
const connections = new Set<ClientConn>()

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function send(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg))
}

/** Input is only accepted for claude-code panes unless the user has
 *  explicitly opted into full terminal control (§ Remote server core —
 *  deliberately off by default: a phone typing into an arbitrary shell
 *  session is a much bigger blast radius than answering a Claude Code
 *  prompt). */
function inputAllowed(tabId: string): boolean {
  const meta = getSessionMeta(tabId)
  if (!meta) return false
  if (meta.tabKind === 'claude-code') return true
  return loadRemoteState().allowFullTerminalInput
}

/** § Mission Control (§1) — last few non-blank lines of a claude-code tab's
 *  scrollback, so a project card can show "roughly what Claude just said"
 *  without the phone opening the session view. */
function lastNonBlankLines(text: string, count: number): string[] {
  const lines = stripAnsi(text)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
  return lines.slice(-count)
}

const STATE_PRIORITY: Record<WaitStatus, number> = { waiting: 0, busy: 1, idle: 2 }

interface ProjectAggregate {
  state: WaitStatus
  stateSince: number
  lastLines: string[]
}

/** § Mission Control (§1) — one card per project needs a single state, not
 *  one per claude-code tab. Picks the most urgent status across the
 *  project's claude-code tabs (waiting beats busy beats idle); ties broken
 *  by whichever has been in that status longest, since "been waiting
 *  longest" is the more useful signal than "most recently changed" for a
 *  glance-and-decide card. A project with no claude-code tab at all reads
 *  as idle with no lines, rather than some fourth "none" state the UI would
 *  have to special-case. */
function aggregateProjectState(claudeTabIds: string[]): ProjectAggregate {
  if (claudeTabIds.length === 0) return { state: 'idle', stateSince: Date.now(), lastLines: [] }

  let winnerId = claudeTabIds[0]
  let winnerState = getWaitStatus(winnerId)
  let winnerSince = getStateSince(winnerId)
  for (const id of claudeTabIds.slice(1)) {
    const state = getWaitStatus(id)
    const since = getStateSince(id)
    const better =
      STATE_PRIORITY[state] < STATE_PRIORITY[winnerState] ||
      (STATE_PRIORITY[state] === STATE_PRIORITY[winnerState] && since < winnerSince)
    if (better) {
      winnerId = id
      winnerState = state
      winnerSince = since
    }
  }
  return { state: winnerState, stateSince: winnerSince, lastLines: lastNonBlankLines(getScrollback(winnerId), 2) }
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0')
}

function quietHoursToClock(q: QuietHours): { start: string; end: string } {
  return {
    start: `${pad2(Math.floor(q.startMinute / 60))}:${pad2(q.startMinute % 60)}`,
    end: `${pad2(Math.floor(q.endMinute / 60))}:${pad2(q.endMinute % 60)}`
  }
}

function clockMinutes(clock: string): number | null {
  const match = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(clock)
  if (!match) return null
  return Number(match[1]) * 60 + Number(match[2])
}

function clockToQuietHours(body: unknown): QuietHours | null {
  if (typeof body !== 'object' || body === null) return null
  const { start, end } = body as { start?: unknown; end?: unknown }
  if (typeof start !== 'string' || typeof end !== 'string') return null
  const startMinute = clockMinutes(start)
  const endMinute = clockMinutes(end)
  if (startMinute === null || endMinute === null) return null
  return { startMinute, endMinute }
}

function getPwaDistDir(): string {
  return electronApp.isPackaged
    ? join(process.resourcesPath, 'remote')
    : join(process.cwd(), 'remote', 'dist')
}

// ---------------------------------------------------------------------------
// REST
// ---------------------------------------------------------------------------

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null
  const device = token ? verifyToken(token) : null
  if (!device) {
    res.status(401).json({ error: 'unauthorized' })
    return
  }
  ;(req as Request & { deviceId?: string }).deviceId = device.id
  next()
}

function buildApp(): express.Express {
  const pwaDistDir = getPwaDistDir()
  const expressApp = express()
  expressApp.use(express.json())

  expressApp.get('/api/health', (_req, res) => {
    res.json({
      version: electronApp.getVersion(),
      uptime: process.uptime(),
      projectCount: listOpenProjectIds().length,
      hostname: hostname()
    })
  })

  expressApp.post('/api/pair', (req, res) => {
    const { pin, deviceName } = (req.body ?? {}) as { pin?: unknown; deviceName?: unknown }
    if (typeof pin !== 'string') {
      res.status(400).json({ error: 'pin required' })
      return
    }
    const result: PairResult = submitPin(pin, typeof deviceName === 'string' ? deviceName : undefined)
    if (!result.ok) {
      res.status(400).json({ error: result.error })
      return
    }
    res.json({ token: result.token, vapidPublicKey: getVapidPublicKey() })
  })

  // Everything registered from here down requires a bearer token — /api/pair
  // and /api/health above are the only exceptions, by virtue of having
  // already matched (and responded) before this middleware runs.
  expressApp.use('/api', authMiddleware)

  expressApp.get('/api/projects', (_req, res) => {
    const projects = listOpenProjectIds()
      .map((projectId) => {
        const config = getProject(projectId)
        if (!config) return null
        const tabs = listSessionIds()
          .map((id) => ({ id, meta: getSessionMeta(id) }))
          .filter(
            (s) =>
              s.meta !== undefined &&
              s.meta.tabKind !== undefined &&
              getProjectIdForWindow(s.meta.windowId) === projectId
          )
          .map((s) => ({
            id: s.id,
            type: s.meta!.tabKind,
            title: s.meta!.tabKind === 'claude-code' ? 'Claude Code' : basename(s.meta!.cwd),
            state: s.meta!.tabKind === 'claude-code' ? getWaitStatus(s.id) : undefined
          }))
        const claudeTabIds = tabs.filter((t) => t.type === 'claude-code').map((t) => t.id)
        const aggregate = aggregateProjectState(claudeTabIds)
        const health: SshHealthStatus = getCachedHealth(projectId) ?? {
          projectId,
          state: 'unknown',
          lastCheckedAt: null
        }
        return {
          id: projectId,
          name: config.name,
          accentColor: config.accentColor,
          tabs,
          state: aggregate.state,
          stateSince: aggregate.stateSince,
          lastLines: aggregate.lastLines,
          sshHealth: { state: health.state, lastCheckedAt: health.lastCheckedAt }
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
    res.json({ projects })
  })

  expressApp.post('/api/tabs/:id/keys', (req, res) => {
    const tabId = req.params.id
    const key = (req.body as { key?: unknown } | undefined)?.key
    if (typeof key !== 'string' || !(key in KEY_BYTES)) {
      res.status(400).json({ error: 'unknown key' })
      return
    }
    if (!inputAllowed(tabId)) {
      res.status(403).json({ error: 'input not allowed for this tab' })
      return
    }
    writePty(tabId, KEY_BYTES[key])
    res.json({ ok: true })
  })

  expressApp.post('/api/push/subscribe', (req: Request & { deviceId?: string }, res) => {
    const subscription = (req.body as { subscription?: PushSubscriptionJson } | undefined)?.subscription
    if (!subscription?.endpoint || !subscription.keys?.p256dh || !subscription.keys?.auth) {
      res.status(400).json({ error: 'invalid subscription' })
      return
    }
    const state = loadRemoteState()
    const device = state.devices.find((d) => d.id === req.deviceId)
    if (!device) {
      res.status(404).json({ error: 'device not found' })
      return
    }
    device.pushSubscription = subscription
    saveRemoteState(state)
    res.json({ ok: true })
  })

  // § actionable notifications (§3) — per-device (not global) mute list +
  // quiet-hours window, read/written by the paired phone's own Settings
  // screen. Per-device rather than one shared setting because push
  // subscriptions are already per-device: a tablet that's always on charger
  // might want every project audible while a phone wants Q2 only and no
  // 2am pings.
  expressApp.get('/api/notifications/settings', (req: Request & { deviceId?: string }, res) => {
    const state = loadRemoteState()
    const device = state.devices.find((d) => d.id === req.deviceId)
    if (!device) {
      res.status(404).json({ error: 'device not found' })
      return
    }
    res.json({
      mutedProjectIds: device.notifyMutedProjectIds ?? [],
      quietHours: device.quietHours ? quietHoursToClock(device.quietHours) : null
    })
  })

  expressApp.post('/api/notifications/settings', (req: Request & { deviceId?: string }, res) => {
    const state = loadRemoteState()
    const device = state.devices.find((d) => d.id === req.deviceId)
    if (!device) {
      res.status(404).json({ error: 'device not found' })
      return
    }
    const body = (req.body ?? {}) as { mutedProjectIds?: unknown; quietHours?: unknown }

    if (body.mutedProjectIds !== undefined) {
      if (!Array.isArray(body.mutedProjectIds) || !body.mutedProjectIds.every((p) => typeof p === 'string')) {
        res.status(400).json({ error: 'invalid mutedProjectIds' })
        return
      }
      device.notifyMutedProjectIds = body.mutedProjectIds
    }

    if (body.quietHours !== undefined) {
      if (body.quietHours === null) {
        device.quietHours = null
      } else {
        const parsed = clockToQuietHours(body.quietHours)
        if (!parsed) {
          res.status(400).json({ error: 'invalid quietHours' })
          return
        }
        device.quietHours = parsed
      }
    }

    saveRemoteState(state)
    res.json({ ok: true })
  })

  expressApp.use(express.static(pwaDistDir))
  expressApp.use((req, res) => {
    if (req.path.startsWith('/api')) {
      res.status(404).json({ error: 'not found' })
      return
    }
    const indexPath = join(pwaDistDir, 'index.html')
    if (existsSync(indexPath)) {
      res.sendFile(indexPath)
    } else {
      res.status(503).send('ShinShell Remote PWA has not been built yet (remote/dist is missing).')
    }
  })

  return expressApp
}

// ---------------------------------------------------------------------------
// WebSocket — one connection per client, multiplexed over tabId-tagged
// frames (see the plan's "Single multiplexed WebSocket" scope decision).
// ---------------------------------------------------------------------------

function attachWebSocket(httpsServer: HttpsServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  httpsServer.on('upgrade', (req, socket, head) => {
    if (req.url !== '/api/ws') {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws: WebSocket) => handleConnection(ws))
  return wss
}

function handleConnection(ws: WebSocket): void {
  const conn: ClientConn = { ws, deviceId: null, subscriptions: new Set(), authTimer: null }
  conn.authTimer = setTimeout(() => {
    if (!conn.deviceId) ws.close(4001, 'auth timeout')
  }, AUTH_GRACE_MS)
  connections.add(conn)

  ws.on('message', (raw) => {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(raw.toString())
    } catch {
      return
    }

    if (!conn.deviceId) {
      if (msg.type === 'auth' && typeof msg.token === 'string') {
        const device = verifyToken(msg.token)
        if (device) {
          conn.deviceId = device.id
          if (conn.authTimer) clearTimeout(conn.authTimer)
          send(ws, { type: 'auth-ok' })
        } else {
          ws.close(4003, 'bad token')
        }
      } else {
        ws.close(4001, 'auth required first')
      }
      return
    }

    handleClientMessage(conn, msg)
  })

  ws.on('close', () => {
    if (conn.authTimer) clearTimeout(conn.authTimer)
    connections.delete(conn)
  })
}

function handleClientMessage(conn: ClientConn, msg: Record<string, unknown>): void {
  if (msg.type === 'subscribe' && typeof msg.tabId === 'string') {
    subscribeTab(conn, msg.tabId)
  } else if (msg.type === 'unsubscribe' && typeof msg.tabId === 'string') {
    conn.subscriptions.delete(msg.tabId)
  } else if (msg.type === 'input' && typeof msg.tabId === 'string' && typeof msg.data === 'string') {
    if (inputAllowed(msg.tabId)) writePty(msg.tabId, msg.data)
  } else if (msg.type === 'resize') {
    // Deliberately a no-op (§ Remote — see plan notes): the pty's real
    // dimensions are owned by the desktop app's own xterm instance. A
    // phone forcing a resize would fight the desktop terminal's own size
    // negotiation every time either client reflows — same class of
    // problem tmux solves with "smallest attached client" policy, which is
    // out of scope here. The phone's xterm.js renders at its own size
    // regardless of the pty's actual cols/rows.
  }
}

function subscribeTab(conn: ClientConn, tabId: string): void {
  if (conn.subscriptions.has(tabId)) return
  conn.subscriptions.add(tabId)
  send(conn.ws, { type: 'scrollback', tabId, data: getScrollback(tabId) })
  send(conn.ws, { type: 'state', tabId, status: getWaitStatus(tabId) })
}

// Global fan-out — registered once at module load, not per connection, so a
// chatty pty doesn't accumulate listeners across reconnects.
ptyEvents.on('data', (e: PtyDataEvent) => {
  for (const conn of connections) {
    if (conn.subscriptions.has(e.id)) send(conn.ws, { type: 'data', tabId: e.id, data: e.data })
  }
})
ptyEvents.on('exit', (e: PtyExitEvent) => {
  for (const conn of connections) {
    if (conn.subscriptions.has(e.id)) {
      send(conn.ws, { type: 'exit', tabId: e.id, exitCode: e.exitCode })
      conn.subscriptions.delete(e.id)
    }
  }
})
waitEvents.on('state', (e: { id: string; status: string }) => {
  for (const conn of connections) {
    if (conn.subscriptions.has(e.id)) send(conn.ws, { type: 'state', tabId: e.id, status: e.status })
  }
  if (e.status === 'waiting') void handleWaitingTransition(e.id)
})

/** § actionable notifications (§3) — "never notify twice for the same
 *  WAITING episode" falls straight out of waitDetector's own invariant
 *  rather than needing a time-based rate limit here: setStatus() only ever
 *  emits a 'state' event on an *actual* transition (it early-returns on a
 *  same-status re-check), so this handler runs exactly once per busy/idle→
 *  waiting transition — i.e. once per episode, by construction — and a
 *  *new* episode (session goes back to busy, then waits again) correctly
 *  gets its own push instead of being swallowed by a cooldown window. */
async function handleWaitingTransition(sessionId: string): Promise<void> {
  const meta = getSessionMeta(sessionId)
  if (!meta) return
  const projectId = getProjectIdForWindow(meta.windowId)
  const project = projectId ? getProject(projectId) : undefined
  const body = project ? `${project.name}: Claude Code needs input` : 'Claude Code needs input'
  await notifyAllDevices({ title: 'Claude is waiting', body, sessionId, projectId })
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

async function renewCertAndRecheckIp(): Promise<void> {
  if (!runtime) return
  const self = await getTailscaleSelf()
  if (!self) return // transient blip — don't tear down a working server over one failed check

  if (self.ip !== runtime.self.ip) {
    // Tailscale IP changed (rare — re-registration) — a bound socket on the
    // old address is stale and needs a real rebind, unlike a cert refresh.
    stopRemoteServer()
    await startRemoteServer()
    return
  }

  try {
    const certPaths = await issueCert(self.exe, self.dnsName)
    runtime.httpsServer.setSecureContext({
      cert: readFileSync(certPaths.certPath),
      key: readFileSync(certPaths.keyPath)
    })
  } catch (err) {
    console.warn('[remote] cert renewal failed:', errMessage(err))
  }
}

export async function startRemoteServer(): Promise<{ ok: boolean; error?: string }> {
  if (runtime) return { ok: true }

  const self = await getTailscaleSelf()
  if (!self) {
    lastError =
      'Tailscale is not running (or not logged in) on this machine — Remote needs an active tailnet connection to bind to.'
    return { ok: false, error: lastError }
  }

  let certPaths
  try {
    certPaths = await issueCert(self.exe, self.dnsName)
  } catch (err) {
    lastError = `Failed to issue a Tailscale HTTPS cert for ${self.dnsName}: ${errMessage(err)}. Make sure "HTTPS Certificates" is enabled for your tailnet at https://login.tailscale.com/admin/dns.`
    return { ok: false, error: lastError }
  }

  ensureVapid()

  const httpsServer = createHttpsServer({
    cert: readFileSync(certPaths.certPath),
    key: readFileSync(certPaths.keyPath)
  })
  httpsServer.on('request', buildApp())
  const wss = attachWebSocket(httpsServer)

  try {
    await new Promise<void>((resolve, reject) => {
      httpsServer.once('error', reject)
      // Bind to the literal Tailscale IP — never 0.0.0.0. See file header.
      httpsServer.listen(PORT, self.ip, () => resolve())
    })
  } catch (err) {
    lastError = `Failed to bind ${self.ip}:${PORT}: ${errMessage(err)}`
    return { ok: false, error: lastError }
  }

  const renewTimer = setInterval(() => void renewCertAndRecheckIp(), CERT_RENEW_INTERVAL_MS)
  runtime = { httpsServer, wss, self, renewTimer }
  lastError = null

  const state = loadRemoteState()
  state.enabled = true
  saveRemoteState(state)

  return { ok: true }
}

/** Runtime teardown only — deliberately does not touch the persisted
 *  `enabled` flag, since this is also called on app quit (where we want
 *  Remote to resume automatically next launch, not be silently disabled).
 *  User-initiated disable clears `enabled` itself; see index.ts's
 *  `remoteSetEnabled` handler. */
export function stopRemoteServer(): void {
  if (!runtime) return
  clearInterval(runtime.renewTimer)
  for (const conn of connections) conn.ws.close(1001, 'server stopping')
  connections.clear()
  runtime.wss.close()
  runtime.httpsServer.close()
  runtime = null
}

export function getRemoteStatus(): RemoteStatus {
  const state = loadRemoteState()
  const pinLive = state.pendingPin && Date.now() < state.pendingPin.expiresAt
  return {
    enabled: state.enabled,
    running: runtime !== null,
    url: runtime ? `https://${runtime.self.dnsName}:${PORT}` : null,
    error: lastError,
    pairedDeviceCount: state.devices.length,
    pendingPin: pinLive ? state.pendingPin!.pin : null,
    allowFullTerminalInput: state.allowFullTerminalInput
  }
}

export async function sendTestNotification(): Promise<void> {
  // bypassFilters — a deliberate "send test" click shouldn't get silently
  // swallowed by whatever quiet-hours window happens to be active.
  await notifyAllDevices(
    {
      title: 'ShinShell Remote',
      body: 'Test notification — if you see this, push is working.',
      sessionId: 'test'
    },
    { bypassFilters: true }
  )
}
