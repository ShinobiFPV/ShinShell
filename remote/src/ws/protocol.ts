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

export interface RemoteTab {
  id: string
  type: 'terminal' | 'claude-code'
  title: string
  state?: WaitStatus
}

export interface RemoteProject {
  id: string
  name: string
  accentColor: string
  tabs: RemoteTab[]
}
