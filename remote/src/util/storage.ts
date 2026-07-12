// § Session view polish (§2) — tiny JSON localStorage wrapper shared by
// every device-local preference (font size, custom quick actions, send
// history). Storage is inherently per-browser-per-device already, which is
// exactly the persistence scope these settings want.
export function loadJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw !== null ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // quota exceeded / storage unavailable (e.g. private browsing) — not
    // fatal, the setting just won't survive a reload.
  }
}
