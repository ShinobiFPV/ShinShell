// § API versioning (§7) — hand-synced against server.ts's API_VERSION
// constant (this is a fully separate TS project from the desktop app, see
// protocol.ts's header for why there's no shared import).
export const API_BASE = '/api/v1'

export function apiUrl(serverUrl: string, path: string): string {
  return `${serverUrl}${API_BASE}${path}`
}

export function wsUrlFor(serverUrl: string): string {
  return `${serverUrl.replace(/^http/, 'ws')}${API_BASE}/ws`
}
