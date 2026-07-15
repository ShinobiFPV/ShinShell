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
import { verifyToken, submitPin, revokeDevice, type PairResult } from './pairing'
import { ensureVapid, getVapidPublicKey, notifyAllDevices } from './push'
import { getScrollback, getSessionMeta, listSessionIds, writePty, ptyEvents, spawnPty } from '../pty'
import { waitEvents, getStatus as getWaitStatus, getStateSince, type WaitStatus } from './waitDetector'
import { stripAnsi } from './ansi'
import {
  listOpenProjectIds,
  getProjectIdForWindow,
  getOpenProjectWindow,
  openProjectWindow,
  closeProjectWindow
} from '../windows'
import { getProject, listProjects } from '../projects'
import { getCachedHealth } from '../sshHealth'
import { validateProjectPath } from '../projectValidation'
import { substituteVariables } from '../../shared/commandSubstitution'
import { appendDeployRun } from '../deployHistory'
import type { RemoteStatus, PtyDataEvent, PtyExitEvent, SshHealthStatus, DeployRun } from '../../shared/ipc'

const PORT = 8443
const CERT_RENEW_INTERVAL_MS = 24 * 60 * 60 * 1000
const AUTH_GRACE_MS = 5000
// § connection UX (§6) — server-side half of the heartbeat: a JSON
// {type:'heartbeat'} frame plus a protocol-level ping every interval, so
// both the client (via the JSON frame, which its own JS can observe) and
// this server (via the ping/pong's `alive` flag, which browsers answer
// automatically at the protocol level without any client JS involved) each
// detect a half-dead socket well inside the plan's ~10s target.
const HEARTBEAT_INTERVAL_MS = 4000

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
  /** § connection UX (§6) — cleared on every heartbeat tick, set again on
   *  the pong reply; a connection that's still false when the *next* tick
   *  fires missed a full interval and gets terminated server-side. Mirrors
   *  the client's own staleness timer, just from the other end. */
  alive: boolean
}

let runtime: Runtime | null = null
let lastError: string | null = null
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
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
  // § remote deploy (§5) — a deploy run is a one-shot command, not an
  // interactive session; it never accepts input, even under
  // allowFullTerminalInput (that toggle is about typing into a shell, not
  // about steering a deploy that's already running).
  if (meta.tabKind === 'deploy') return false
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

/** § remote deploy (§5) — the exact same command set the desktop's own
 *  Deploy tab exposes (DeployTab.tsx filters on this same id prefix), so
 *  there's never drift between "what the desktop Deploy tab can run" and
 *  "what a paired phone can trigger." `command` is the fully-substituted
 *  string (real hostnames, real paths) so the phone's arm-to-confirm
 *  countdown can show exactly what will fire, per the plan's requirement. */
function deployCommandsFor(config: NonNullable<ReturnType<typeof getProject>>): {
  id: string
  label: string
  dangerous: boolean
  command: string
}[] {
  return config.commands
    .filter((c) => c.id.startsWith('deploy'))
    .map((c) => ({
      id: c.id,
      label: c.label,
      dangerous: Boolean(c.dangerous),
      command: substituteVariables(c.command, config)
    }))
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

// § API versioning (§7) — every REST/WS route lives under this prefix. A
// service-worker-cached PWA build (possibly stale — ShinShell auto-updates
// via electron-updater, but a phone's cached app shell doesn't know that
// happened) hitting a server whose API shape has since moved on gets a
// clean 404 instead of a route that quietly behaves differently; the PWA
// itself separately compares its own build-time ShinShell version against
// GET /health's `version` and warns loudly on a mismatch rather than
// leaving it to manifest as confusing one-off failures (see
// remote/src/versionCheck.ts).
const API_VERSION = 'v1'

function buildApp(): express.Express {
  const pwaDistDir = getPwaDistDir()
  const expressApp = express()
  expressApp.use(express.json())

  const v1 = express.Router()

  v1.get('/health', (_req, res) => {
    res.json({
      version: electronApp.getVersion(),
      uptime: process.uptime(),
      projectCount: listOpenProjectIds().length,
      hostname: hostname()
    })
  })

  v1.post('/pair', (req, res) => {
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

  // Everything registered from here down requires a bearer token — /pair
  // and /health above are the only exceptions, by virtue of having already
  // matched (and responded) before this middleware runs.
  v1.use(authMiddleware)

  v1.get('/projects', (_req, res) => {
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
            title: s.meta!.tabKind === 'claude-code' ? 'Claude Code' : (s.meta!.label ?? basename(s.meta!.cwd)),
            state: s.meta!.tabKind === 'claude-code' ? getWaitStatus(s.id) : undefined
          }))
        const claudeTabIds = tabs.filter((t) => t.type === 'claude-code').map((t) => t.id)
        const aggregate = aggregateProjectState(claudeTabIds)
        const health: SshHealthStatus = getCachedHealth(projectId) ?? {
          projectId,
          state: 'unknown',
          lastCheckedAt: null
        }
        const remoteState = loadRemoteState()
        return {
          id: projectId,
          name: config.name,
          accentColor: config.accentColor,
          tabs,
          state: aggregate.state,
          stateSince: aggregate.stateSince,
          lastLines: aggregate.lastLines,
          sshHealth: { state: health.state, lastCheckedAt: health.lastCheckedAt },
          // § remote deploy (§5) — opt-in: omitted entirely (not just
          // empty) while the toggle is off, so a stolen device token
          // doesn't even learn a project's deploy command set.
          deployCommands: remoteState.allowDeploy ? deployCommandsFor(config) : undefined
        }
      })
      .filter((p): p is NonNullable<typeof p> => p !== null)
    // § read-only visibility (§4) / § remote deploy (§5) — both flags
    // travel with the list rather than needing their own endpoints: they're
    // the bits the PWA needs to decide whether a tab's input bar, or a
    // card's deploy buttons, should show at all.
    const remoteState = loadRemoteState()
    // § remote project control — like deployCommands above, omitted
    // entirely (not just empty) while the toggle is off: a stolen device
    // token shouldn't even learn which projects are configured but closed.
    const closedProjects = remoteState.allowProjectControl
      ? listProjects()
          .filter((p) => !listOpenProjectIds().includes(p.id))
          .map((p) => ({ id: p.id, name: p.name, accentColor: p.accentColor }))
      : undefined
    res.json({
      projects,
      allowFullTerminalInput: remoteState.allowFullTerminalInput,
      allowDeploy: remoteState.allowDeploy,
      allowProjectControl: remoteState.allowProjectControl,
      closedProjects
    })
  })

  // § remote project control — opens a project window on the desktop from a
  // paired phone. Mirrors the desktop launcher's own "open project" click;
  // openProjectWindow() itself is idempotent (focuses an already-open
  // window) so this is safe to call redundantly.
  v1.post('/projects/:projectId/open', (req, res) => {
    if (!loadRemoteState().allowProjectControl) {
      res.status(403).json({ error: 'remote project control is not enabled' })
      return
    }
    const config = getProject(req.params.projectId)
    if (!config) {
      res.status(404).json({ error: 'project not found' })
      return
    }
    const win = openProjectWindow(req.params.projectId)
    if (!win) {
      res.status(500).json({ error: 'failed to open project window' })
      return
    }
    res.json({ ok: true })
  })

  // § remote project control — closes a project window, tearing down its
  // sessions exactly as the OS close button would (see
  // windows.ts's closeProjectWindow).
  v1.post('/projects/:projectId/close', (req, res) => {
    if (!loadRemoteState().allowProjectControl) {
      res.status(403).json({ error: 'remote project control is not enabled' })
      return
    }
    const closed = closeProjectWindow(req.params.projectId)
    if (!closed) {
      res.status(404).json({ error: 'project window not open' })
      return
    }
    res.json({ ok: true })
  })

  // § remote deploy (§5) — stateless by design: arm-to-confirm for
  // `dangerous` commands is a client-side (phone UI) gate, exactly like the
  // desktop's own requestConfirm()/ArmedCommandBanner — the desktop doesn't
  // ask the main process to track "armed" state either, so this endpoint
  // just runs the command the instant it's called, same trust boundary as
  // every other authenticated Remote request.
  v1.post('/projects/:projectId/commands/:commandId/run', (req, res) => {
    if (!loadRemoteState().allowDeploy) {
      res.status(403).json({ error: 'remote deploy is not enabled' })
      return
    }
    const { projectId, commandId } = req.params
    if (!listOpenProjectIds().includes(projectId)) {
      res.status(404).json({ error: 'project not open' })
      return
    }
    const config = getProject(projectId)
    if (!config) {
      res.status(404).json({ error: 'project not found' })
      return
    }
    const command = deployCommandsFor(config).find((c) => c.id === commandId)
    if (!command) {
      res.status(404).json({ error: 'command not found' })
      return
    }
    const pathCheck = validateProjectPath(config.workingDir)
    if (!pathCheck.valid) {
      res.status(409).json({ error: pathCheck.reason ?? 'project folder not found' })
      return
    }
    const win = getOpenProjectWindow(projectId)
    if (!win) {
      res.status(404).json({ error: 'project window not open' })
      return
    }

    const runId = `remote-deploy-${projectId}-${Date.now()}`
    const startedAt = Date.now()
    spawnPty(win, {
      id: runId,
      cwd: config.workingDir,
      cols: 120,
      rows: 40,
      shell: config.shell,
      env: config.env,
      oneShotCommand: command.command,
      tabKind: 'deploy',
      label: command.label
    })

    const onExit = (e: PtyExitEvent): void => {
      if (e.id !== runId) return
      ptyEvents.off('exit', onExit)
      const run: DeployRun = {
        commandId: command.id,
        commandLabel: command.label,
        startedAt,
        durationMs: Date.now() - startedAt,
        exitCode: e.exitCode
      }
      appendDeployRun(projectId, run)
      const ok = e.exitCode === 0
      void notifyAllDevices({
        title: `${config.name}: deploy ${ok ? 'succeeded' : 'failed'}`,
        body: `${command.label} — exit ${e.exitCode}, ${(run.durationMs / 1000).toFixed(1)}s`,
        sessionId: runId,
        projectId
      })
    }
    ptyEvents.on('exit', onExit)

    res.json({ ok: true, runId })
  })

  v1.post('/tabs/:id/keys', (req, res) => {
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

  v1.post('/push/subscribe', (req: Request & { deviceId?: string }, res) => {
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
  v1.get('/notifications/settings', (req: Request & { deviceId?: string }, res) => {
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

  v1.post('/notifications/settings', (req: Request & { deviceId?: string }, res) => {
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

  // § housekeeping (§7) — paired-devices screen: list every paired device
  // (flagging which one is *this* device, from the requesting bearer
  // token) and let the phone revoke any of them, itself included — revoking
  // self is equivalent to the desktop's own "Revoke" and simply invalidates
  // this device's token going forward; the PWA notices via the next 401 and
  // forgets its local pairing.
  v1.get('/devices', (req: Request & { deviceId?: string }, res) => {
    const state = loadRemoteState()
    res.json({
      devices: state.devices.map((d) => ({
        id: d.id,
        name: d.name,
        pairedAt: d.pairedAt,
        lastSeenAt: d.lastSeenAt,
        hasPushSubscription: Boolean(d.pushSubscription),
        isThisDevice: d.id === req.deviceId
      }))
    })
  })

  v1.post('/devices/:id/revoke', (req, res) => {
    revokeDevice(req.params.id)
    res.json({ ok: true })
  })

  expressApp.use(`/api/${API_VERSION}`, v1)

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

function startHeartbeat(): void {
  heartbeatTimer = setInterval(() => {
    for (const conn of connections) {
      if (!conn.deviceId) continue // pre-auth — AUTH_GRACE_MS's own timeout already covers this
      if (!conn.alive) {
        conn.ws.terminate()
        continue
      }
      conn.alive = false
      conn.ws.ping()
      send(conn.ws, { type: 'heartbeat' })
    }
  }, HEARTBEAT_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) clearInterval(heartbeatTimer)
  heartbeatTimer = null
}

function attachWebSocket(httpsServer: HttpsServer): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true })

  httpsServer.on('upgrade', (req, socket, head) => {
    if (req.url !== `/api/${API_VERSION}/ws`) {
      socket.destroy()
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws: WebSocket) => handleConnection(ws))
  return wss
}

function handleConnection(ws: WebSocket): void {
  const conn: ClientConn = { ws, deviceId: null, subscriptions: new Set(), authTimer: null, alive: true }
  conn.authTimer = setTimeout(() => {
    if (!conn.deviceId) ws.close(4001, 'auth timeout')
  }, AUTH_GRACE_MS)
  connections.add(conn)
  ws.on('pong', () => {
    conn.alive = true
  })

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
  startHeartbeat()

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
  stopHeartbeat()
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
    allowFullTerminalInput: state.allowFullTerminalInput,
    allowDeploy: state.allowDeploy,
    allowProjectControl: state.allowProjectControl
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
