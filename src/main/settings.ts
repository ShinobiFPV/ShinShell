import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { Settings } from '../shared/ipc'

// Global app settings — currently just the multiline-paste-guard skip flag
// (§ clipboard fix). Follows appState.ts's exact read/write convention
// (this codebase hand-rolls this per state file rather than sharing a
// helper); a separate file from appState.ts/remote.json since this is a
// distinct concern (user preference, not window-restore or remote-server
// state).

function defaultSettings(): Settings {
  return { skipMultilinePasteGuard: false }
}

const settingsPath = (): string => join(app.getPath('userData'), 'settings.json')

export function loadSettings(): Settings {
  const path = settingsPath()
  if (!existsSync(path)) return defaultSettings()
  try {
    return { ...defaultSettings(), ...(JSON.parse(readFileSync(path, 'utf-8')) as Partial<Settings>) }
  } catch {
    return defaultSettings()
  }
}

export function saveSettings(settings: Settings): void {
  const path = settingsPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(settings, null, 2), 'utf-8')
}
