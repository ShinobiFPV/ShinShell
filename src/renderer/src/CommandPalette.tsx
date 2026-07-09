import { useEffect, useMemo, useRef, useState } from 'react'
import { fuzzyScore } from './fuzzy'

export interface PaletteAction {
  id: string
  label: string
  category: string
  run: () => void
}

interface CommandPaletteProps {
  actions: PaletteAction[]
  onClose: () => void
}

// §6.11 — Ctrl+Shift+P fuzzy palette over saved commands, tab actions, and
// project switching. `actions` is pre-built by the caller (ProjectWindow),
// which already owns the closures for running commands / creating tabs /
// switching projects.
export default function CommandPalette({ actions, onClose }: CommandPaletteProps): JSX.Element {
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const matches = useMemo(() => {
    if (!query) return actions.slice(0, 50)
    return actions
      .map((a) => ({ action: a, score: fuzzyScore(query, `${a.category} ${a.label}`) }))
      .filter((m): m is { action: PaletteAction; score: number } => m.score !== null)
      .sort((a, b) => b.score - a.score)
      .map((m) => m.action)
      .slice(0, 50)
  }, [actions, query])

  useEffect(() => {
    setSelected(0)
  }, [query])

  const runSelected = (index: number): void => {
    const action = matches[index]
    if (action) {
      onClose()
      action.run()
    }
  }

  return (
    <div className="command-picker-backdrop" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={inputRef}
          className="palette-input"
          placeholder="Type a command, tab action, or project name…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              onClose()
            } else if (e.key === 'ArrowDown') {
              e.preventDefault()
              setSelected((s) => Math.min(s + 1, matches.length - 1))
            } else if (e.key === 'ArrowUp') {
              e.preventDefault()
              setSelected((s) => Math.max(s - 1, 0))
            } else if (e.key === 'Enter') {
              e.preventDefault()
              runSelected(selected)
            }
          }}
        />
        <div className="palette-list">
          {matches.length === 0 ? (
            <div className="palette-empty">No matches.</div>
          ) : (
            matches.map((a, i) => (
              <button
                key={a.id}
                className={`palette-item${i === selected ? ' selected' : ''}`}
                onMouseEnter={() => setSelected(i)}
                onMouseDown={() => runSelected(i)}
              >
                <span className="palette-item-category">{a.category}</span>
                <span className="palette-item-label">{a.label}</span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  )
}
