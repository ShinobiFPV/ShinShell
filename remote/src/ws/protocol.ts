// § ShinShell Remote wire protocol — hand-synced against the frame shapes
// in src/main/remote/server.ts's handleClientMessage/global fan-out (this
// is a fully separate TS project from the desktop app, so there's no
// shared import; keep these two files in sync by hand if the protocol
// changes).

export type WaitStatus = 'busy' | 'waiting' | 'idle'

export type ClientFrame =
  | { type: 'auth'; token: string }
  | { type: 'subscribe'; tabId: string }
  | { type: 'unsubscribe'; tabId: string }
  | { type: 'input'; tabId: string; data: string }
  | { type: 'resize'; tabId: string; cols: number; rows: number }

export type ServerFrame =
  | { type: 'auth-ok' }
  | { type: 'scrollback'; tabId: string; data: string }
  | { type: 'state'; tabId: string; status: WaitStatus }
  | { type: 'data'; tabId: string; data: string }
  | { type: 'exit'; tabId: string; exitCode: number }

// § read-only visibility (§4) — 'log-tail' (and any future non-claude-code
// pty-backed tab kind) shows up here too now, not just terminal/claude-code;
// server.ts's GET /api/projects only ever includes kinds that actually have
// a live pty session (editor/scratchpad/claude-chat/ports have none, so
// they're simply absent — there's nothing to stream).
export interface RemoteTab {
  id: string
  type: 'terminal' | 'claude-code' | 'log-tail'
  title: string
  state?: WaitStatus
}

export type SshHealthState = 'checking' | 'up' | 'down' | 'unknown'

export interface RemoteSshHealth {
  state: SshHealthState
  lastCheckedAt: number | null
}

// § Mission Control (§1) — the dashboard's per-project aggregate: `state`/
// `stateSince` are the most-urgent-claude-code-tab summary computed server
// side by server.ts's aggregateProjectState (idle/now/[] when the project
// has no claude-code tab at all), `lastLines` are that tab's last ~2
// non-blank output lines.
export interface RemoteProject {
  id: string
  name: string
  accentColor: string
  tabs: RemoteTab[]
  state: WaitStatus
  stateSince: number
  lastLines: string[]
  sshHealth: RemoteSshHealth
}

// § actionable notifications (§3) — per-device push prefs, mirrors
// server.ts's GET/POST /api/notifications/settings. mutedProjectIds is an
// opt-out list (absence/empty = notify for everything); quietHours times
// are "HH:MM" 24h strings in ShinShell's own local time zone.
export interface NotificationSettings {
  mutedProjectIds: string[]
  quietHours: { start: string; end: string } | null
}

// § Mission Control (§1) — GET /api/health, polled for the dashboard's
// slim footer (ShinShell version/uptime/PC name). No auth required (see
// server.ts) so it resolves even before the "ShinShell reachable" check
// that gates the rest of the app.
export interface RemoteHealth {
  version: string
  uptime: number
  projectCount: number
  hostname: string
}
