// § connection UX (§6) — the last successful GET /api/projects / /api/health
// response, persisted so a cold app launch with no connectivity can paint
// the dashboard from what it already knew (clearly timestamped) instead of
// a blank "no projects" screen that's indistinguishable from "there really
// are none." localStorage rather than a Cache-API/service-worker entry —
// it already survives a cold launch exactly as well, and app.tsx can seed
// state from it synchronously before the first fetch even starts.
import { loadJSON, saveJSON } from './util/storage'
import type { RemoteHealth, RemoteProjectsResponse } from './ws/protocol'

const PROJECTS_KEY = 'shinshell-remote-last-projects'
const HEALTH_KEY = 'shinshell-remote-last-health'

export interface Timestamped<T> {
  data: T
  at: number
}

export function loadLastProjects(): Timestamped<RemoteProjectsResponse> | null {
  return loadJSON<Timestamped<RemoteProjectsResponse> | null>(PROJECTS_KEY, null)
}

export function saveLastProjects(data: RemoteProjectsResponse): void {
  saveJSON(PROJECTS_KEY, { data, at: Date.now() })
}

export function loadLastHealth(): Timestamped<RemoteHealth> | null {
  return loadJSON<Timestamped<RemoteHealth> | null>(HEALTH_KEY, null)
}

export function saveLastHealth(data: RemoteHealth): void {
  saveJSON(HEALTH_KEY, { data, at: Date.now() })
}

/** Called on "forget this device" — a re-pair (possibly against a
 *  different ShinShell instance entirely) shouldn't briefly flash the
 *  previous instance's stale dashboard before the first live fetch lands. */
export function clearLastKnown(): void {
  localStorage.removeItem(PROJECTS_KEY)
  localStorage.removeItem(HEALTH_KEY)
}
