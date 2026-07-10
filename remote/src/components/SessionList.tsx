import type { JSX } from 'preact'
import type { RemoteProject } from '../ws/protocol'
import StatusBadge from './StatusBadge'

interface SessionListProps {
  projects: RemoteProject[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
}

// § ShinShell Remote — horizontally-scrollable chip strip, one chip per
// open terminal/claude-code tab across every open project, tinted with
// that tab's *project* accent color. State dots refresh from the ~5s
// GET /api/projects poll in app.tsx (not live WS) — deliberate: only the
// actively-viewed tab subscribes over the WS for true real-time data, so
// idle chips don't each cost a live subscription/stream.
export default function SessionList({ projects, activeTabId, onSelect }: SessionListProps): JSX.Element {
  const chips = projects.flatMap((project) => project.tabs.map((tab) => ({ project, tab })))

  if (chips.length === 0) {
    return <div class="session-list-empty">No terminal or Claude Code sessions open right now.</div>
  }

  return (
    <div class="session-list">
      {chips.map(({ project, tab }) => (
        <button
          key={tab.id}
          class={`session-chip${tab.id === activeTabId ? ' active' : ''}`}
          style={{ '--chip-accent': project.accentColor } as Record<string, string>}
          onClick={() => onSelect(tab.id)}
        >
          <StatusBadge status={tab.state} />
          <span class="session-chip-label">
            {project.name} · {tab.title}
          </span>
        </button>
      ))}
    </div>
  )
}
