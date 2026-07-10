import type { ProjectConfig } from '../../shared/project'

interface ParsedHotkey {
  ctrl: boolean
  shift: boolean
  alt: boolean
  key: string
}

// Parses strings like "Ctrl+1", "Ctrl+Shift+1", "Ctrl+\\" (spec §7/§8 format).
export function parseHotkey(hotkey: string): ParsedHotkey {
  const parts = hotkey.split('+')
  const key = (parts[parts.length - 1] || '').toLowerCase()
  return {
    ctrl: parts.some((p) => p.toLowerCase() === 'ctrl'),
    shift: parts.some((p) => p.toLowerCase() === 'shift'),
    alt: parts.some((p) => p.toLowerCase() === 'alt'),
    key
  }
}

// KeyboardEvent.key reflects the *produced character*, which shifts under
// Shift (Shift+9 → "(", not "9") — so matching hotkeys against it silently
// breaks every Ctrl+Shift+<digit> binding. KeyboardEvent.code is the
// physical key regardless of modifiers/layout; map the hotkey's trailing
// token to its code and match on that instead.
function keyToCode(key: string): string | null {
  if (/^[a-z]$/i.test(key)) return `Key${key.toUpperCase()}`
  if (/^[0-9]$/.test(key)) return `Digit${key}`
  const named: Record<string, string> = {
    '\\': 'Backslash',
    '/': 'Slash',
    '`': 'Backquote',
    '-': 'Minus',
    '=': 'Equal',
    '[': 'BracketLeft',
    ']': 'BracketRight',
    ';': 'Semicolon',
    "'": 'Quote',
    ',': 'Comma',
    '.': 'Period'
  }
  return named[key] ?? null
}

export function matchesHotkey(e: KeyboardEvent, hotkey: string): boolean {
  const parsed = parseHotkey(hotkey)
  if (e.ctrlKey !== parsed.ctrl || e.shiftKey !== parsed.shift || e.altKey !== parsed.alt) return false
  const code = keyToCode(parsed.key)
  return code ? e.code === code : e.key.toLowerCase() === parsed.key
}

const hotkeyId = (h: ParsedHotkey): string => `${h.ctrl ? 'ctrl+' : ''}${h.shift ? 'shift+' : ''}${h.alt ? 'alt+' : ''}${h.key}`

// Reserved app-level bindings (App.tsx's own keydown handler) that project
// commands must not silently shadow — §8: "editable in settings with
// conflict detection." No settings UI yet to surface this in, so for now
// conflicts are logged to the console (visible via DevTools) rather than
// blocking config load — the config files are already meant to be
// human-editable directly (§3).
const RESERVED = ['ctrl+t', 'ctrl+w', 'ctrl+tab', 'ctrl+\\', 'ctrl+shift+\\', 'ctrl+/']

export function findHotkeyConflicts(config: ProjectConfig): string[] {
  const conflicts: string[] = []
  const seen = new Map<string, string>() // normalized hotkey -> command label

  for (const cmd of config.commands) {
    if (!cmd.hotkey) continue
    const id = hotkeyId(parseHotkey(cmd.hotkey))

    if (RESERVED.includes(id)) {
      conflicts.push(`"${cmd.label}" (${cmd.hotkey}) conflicts with a built-in ShinShell shortcut`)
      continue
    }
    const existing = seen.get(id)
    if (existing) {
      conflicts.push(`"${cmd.label}" and "${existing}" both use ${cmd.hotkey}`)
    } else {
      seen.set(id, cmd.label)
    }
  }
  return conflicts
}
