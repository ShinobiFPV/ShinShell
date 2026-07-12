// § Session view polish (§2) — every device-local (not server-known)
// preference for the session view: terminal font size, the user-editable
// quick-action row, and the text input's send-history.
import { loadJSON, saveJSON } from './util/storage'

const FONT_SIZE_KEY = 'shinshell-remote-font-size'
const CUSTOM_ACTIONS_KEY = 'shinshell-remote-custom-actions'
const SEND_HISTORY_KEY = 'shinshell-remote-send-history'

export const DEFAULT_FONT_SIZE = 13
export const MIN_FONT_SIZE = 9
export const MAX_FONT_SIZE = 26

export function clampFontSize(size: number): number {
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, Math.round(size)))
}

export function loadFontSize(): number {
  return clampFontSize(loadJSON(FONT_SIZE_KEY, DEFAULT_FONT_SIZE))
}

export function saveFontSize(size: number): void {
  saveJSON(FONT_SIZE_KEY, clampFontSize(size))
}

export interface CustomAction {
  id: string
  label: string
  value: string
}

export function loadCustomActions(): CustomAction[] {
  return loadJSON<CustomAction[]>(CUSTOM_ACTIONS_KEY, [])
}

export function saveCustomActions(actions: CustomAction[]): void {
  saveJSON(CUSTOM_ACTIONS_KEY, actions)
}

const SEND_HISTORY_CAP = 20

export function loadSendHistory(): string[] {
  return loadJSON<string[]>(SEND_HISTORY_KEY, [])
}

/** Pushes to the front (most recent first), de-duping an exact repeat
 *  rather than letting it pile up, and returns the updated list so callers
 *  can update their own state without a second read. */
export function pushSendHistory(entry: string): string[] {
  const trimmed = entry.trim()
  if (!trimmed) return loadSendHistory()
  const deduped = loadSendHistory().filter((e) => e !== trimmed)
  const next = [trimmed, ...deduped].slice(0, SEND_HISTORY_CAP)
  saveJSON(SEND_HISTORY_KEY, next)
  return next
}
