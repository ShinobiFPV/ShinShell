import type { JSX } from 'preact'
import type { RemoteProject } from '../ws/protocol'
import StatusBadge from './StatusBadge'

interface SessionListProps {
  projects: RemoteProject[]
  activeTabId: string | null
  onSelect: (tabId: string) => void
  /** § read-only visibility (§4) — whether non-claude-code tabs accept
   *  input right now (the desktop's allowFullTerminalInput toggle), purely
   *  to decide whether the "view only" marker below is accurate. */
  allowFullTerminalInput?: boolean
}

// § ShinShell Remote — horizontally-scrollable chip strip, one chip per
// open terminal/claude-code/log-tail tab across every open project, tinted
// with that tab's *project* accent color. State dots refresh from the ~5s
// GET /api/projects poll in app.tsx (not live WS) — deliberate: only the
// actively-viewed tab subscribes over the WS for true real-time data, so
// idle chips don't each cost a live subscription/stream.
export default function SessionList({
  projects,
  activeTabId,
  onSelect,
  allowFullTerminalInput
}: SessionListProps): JSX.Element {
  const chips = projects.flatMap((project) => project.tabs.map((tab) => ({ project, tab })))

  if (chips.length === 0) {
    return <div class="session-list-empty">No terminal or Claude Code sessions open right now.</div>
  }

  return (
    <div class="session-list">
      {chips.map(({ project, tab }) => {
        const viewOnly = tab.type !== 'claude-code' && !allowFullTerminalInput
        return (
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
            {viewOnly && <span class="session-chip-view-only">view only</span>}
          </button>
        )
      })}
    </div>
  )
}
