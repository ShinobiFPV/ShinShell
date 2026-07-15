import type { ClientFrame, ServerFrame, WaitStatus } from './protocol'

interface TabListeners {
  onScrollback?: (payload: { data: string }) => void
  onData?: (payload: { data: string }) => void
  onState?: (payload: { status: WaitStatus }) => void
  onExit?: (payload: { exitCode: number }) => void
  onResize?: (payload: { cols: number; rows: number }) => void
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000
// § connection UX (§6) — the server sends a heartbeat frame every ~4s (see
// server.ts); if nothing at all arrives for this long, the socket is
// treated as half-dead (readyState can still read "open" on a connection
// that's actually stopped delivering — e.g. the phone's wifi silently
// dropped without a clean TCP close) and force-closed so the existing
// backoff-reconnect loop takes over instead of sitting on a dead socket.
const STALE_TIMEOUT_MS = 10000

// § ShinShell Remote — one WebSocket connection per client, multiplexing
// every subscribed tab's data/state/exit frames (see the plan's "Single
// multiplexed WebSocket" scope decision). Handles the auth-frame handshake,
// reconnect-with-backoff, and automatic re-subscription after a reconnect.
export class MultiplexClient {
  private ws: WebSocket | null = null
  private readonly tabListeners = new Map<string, TabListeners>()
  private readonly subscribed = new Set<string>()
  private readonly connectionListeners = new Set<(connected: boolean) => void>()
  private reconnectAttempt = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private staleTimer: ReturnType<typeof setTimeout> | null = null
  private closedByUser = false

  constructor(
    private readonly url: string,
    private readonly token: string
  ) {}

  connect(): void {
    this.closedByUser = false
    this.openSocket()
  }

  close(): void {
    this.closedByUser = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.clearStaleTimer()
    this.ws?.close()
  }

  onConnectionChange(cb: (connected: boolean) => void): () => void {
    this.connectionListeners.add(cb)
    return () => this.connectionListeners.delete(cb)
  }

  subscribe(tabId: string, listeners: TabListeners): () => void {
    this.tabListeners.set(tabId, listeners)
    this.subscribed.add(tabId)
    this.sendSubscribe(tabId)
    return () => this.unsubscribe(tabId)
  }

  unsubscribe(tabId: string): void {
    this.tabListeners.delete(tabId)
    this.subscribed.delete(tabId)
    this.send({ type: 'unsubscribe', tabId })
  }

  sendInput(tabId: string, data: string): void {
    this.send({ type: 'input', tabId, data })
  }

  private openSocket(): void {
    const ws = new WebSocket(this.url)
    this.ws = ws

    ws.addEventListener('open', () => {
      this.send({ type: 'auth', token: this.token })
      this.resetStaleTimer()
    })

    ws.addEventListener('message', (event) => {
      // Any bytes at all prove the socket is alive — reset before parsing,
      // so even a frame this client doesn't recognize still counts.
      this.resetStaleTimer()
      let frame: ServerFrame
      try {
        frame = JSON.parse(event.data as string)
      } catch {
        return
      }
      this.handleFrame(frame)
    })

    ws.addEventListener('close', () => {
      this.clearStaleTimer()
      this.notifyConnection(false)
      if (!this.closedByUser) this.scheduleReconnect()
    })

    ws.addEventListener('error', () => ws.close())
  }

  private resetStaleTimer(): void {
    this.clearStaleTimer()
    this.staleTimer = setTimeout(() => {
      // No heartbeat (or anything else) in STALE_TIMEOUT_MS — don't wait on
      // the browser to eventually notice; force the reconnect loop now.
      this.ws?.close()
    }, STALE_TIMEOUT_MS)
  }

  private clearStaleTimer(): void {
    if (this.staleTimer) clearTimeout(this.staleTimer)
    this.staleTimer = null
  }

  private handleFrame(frame: ServerFrame): void {
    if (frame.type === 'auth-ok') {
      this.reconnectAttempt = 0
      this.notifyConnection(true)
      // Re-subscribe to whatever was live before a reconnect — the server
      // has no memory of a client across a dropped connection.
      for (const tabId of this.subscribed) this.sendSubscribe(tabId)
      return
    }
    // Nothing to do beyond the resetStaleTimer() every message already
    // gets in the 'message' listener above — its only job is proving the
    // socket is still alive.
    if (frame.type === 'heartbeat') return
    const listeners = this.tabListeners.get(frame.tabId)
    if (!listeners) return
    if (frame.type === 'scrollback') listeners.onScrollback?.({ data: frame.data })
    else if (frame.type === 'data') listeners.onData?.({ data: frame.data })
    else if (frame.type === 'state') listeners.onState?.({ status: frame.status })
    else if (frame.type === 'exit') listeners.onExit?.({ exitCode: frame.exitCode })
    else if (frame.type === 'resize') listeners.onResize?.({ cols: frame.cols, rows: frame.rows })
  }

  private notifyConnection(connected: boolean): void {
    for (const cb of this.connectionListeners) cb(connected)
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.reconnectAttempt, RECONNECT_MAX_MS)
    this.reconnectAttempt += 1
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay)
  }

  private send(frame: ClientFrame): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(frame))
  }

  private sendSubscribe(tabId: string): void {
    this.send({ type: 'subscribe', tabId })
  }
}
