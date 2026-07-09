import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

// App-level state: which project windows were open, for full-session restore
// (§4: "reopening the app restores windows, tabs, working directories").
// Per-tab/cwd state lives inside each project's own config (see projects.ts);
// this file only tracks the set of open project windows.
export interface AppState {
  openProjectIds: string[]
}

const appStatePath = (): string => join(app.getPath('userData'), 'app-state.json')

export function loadAppState(): AppState {
  const path = appStatePath()
  if (!existsSync(path)) return { openProjectIds: [] }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as AppState
  } catch {
    return { openProjectIds: [] }
  }
}

export function saveAppState(state: AppState): void {
  const path = appStatePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
}
