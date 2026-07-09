import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import type { SessionState } from '../shared/ipc'

const sessionPath = (): string => join(app.getPath('userData'), 'session.json')

export function loadSession(): SessionState {
  const path = sessionPath()
  if (!existsSync(path)) return { tabs: [], activeTabId: null }
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as SessionState
  } catch {
    return { tabs: [], activeTabId: null }
  }
}

export function saveSession(state: SessionState): void {
  const path = sessionPath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
}
