import type { ClientFrame, ServerFrame, WaitStatus } from './protocol'

interface TabListeners {
  onScrollback?: (payload: { data: string }) => void
  onData?: (payload: { data: string }) => void
  onState?: (payload: { status: WaitStatus }) => void
  onExit?: (payload: { exitCode: number }) => void
}

const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 15000

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
    })

    ws.addEventListener('message', (event) => {
      let frame: ServerFrame
      try {
        frame = JSON.parse(event.data as string)
      } catch {
        return
      }
      this.handleFrame(frame)
    })

    ws.addEventListener('close', () => {
      this.notifyConnection(false)
      if (!this.closedByUser) this.scheduleReconnect()
    })

    ws.addEventListener('error', () => ws.close())
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
    const listeners = this.tabListeners.get(frame.tabId)
    if (!listeners) return
    if (frame.type === 'scrollback') listeners.onScrollback?.({ data: frame.data })
    else if (frame.type === 'data') listeners.onData?.({ data: frame.data })
    else if (frame.type === 'state') listeners.onState?.({ status: frame.status })
    else if (frame.type === 'exit') listeners.onExit?.({ exitCode: frame.exitCode })
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
