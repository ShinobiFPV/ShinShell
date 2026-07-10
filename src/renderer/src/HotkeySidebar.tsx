import type { ProjectCommand, ProjectConfig } from '../../shared/project'
import { findCommandTarget } from '../../shared/commandSubstitution'
import type { ArmedCommand } from './ProjectWindow'

interface HotkeySidebarProps {
  config: ProjectConfig
  armed: ArmedCommand | null
  expanded: boolean
  pinned: boolean
  onRunCommand: (cmd: ProjectCommand) => void
  onToggleExpanded: () => void
  onTogglePinned: () => void
  onEditProject: () => void
}

// The trailing key of a hotkey string ("Ctrl+Shift+1" → "1") — enough to
// glance at the collapsed rail and know "there's a binding here."
function hotkeyGlyph(hotkey: string): string {
  const parts = hotkey.split('+')
  return parts[parts.length - 1] || hotkey
}

// §UX4 — the hotkey cheat-sheet lives here instead of cluttering the top of
// the window: a slim always-visible rail (collapsed, 40px) that expands via
// Ctrl+/ or a click into a full 280px command list. Rows reuse onRunCommand
// (the same gate ProjectWindow's hotkey dispatch uses), so dangerous commands
// still arm-then-fire from a click exactly like they do from the keyboard.
//
// The outer element is always a flex sibling of the tab content (never an
// overlay) so its width transition actually resizes the content area and
// every mounted terminal reflows through its own ResizeObserver — that's
// what makes the expand/collapse a "slide" instead of a layer swap.
export default function HotkeySidebar({
  config,
  armed,
  expanded,
  pinned,
  onRunCommand,
  onToggleExpanded,
  onTogglePinned,
  onEditProject
}: HotkeySidebarProps): JSX.Element {
  const hotkeyed = config.commands.filter((c) => c.hotkey)

  return (
    <div className={`hotkey-sidebar${expanded ? ' expanded' : ''}`}>
      {expanded ? (
        <div className="hotkey-panel">
          <div className="hotkey-panel-header">
            <span>{config.name} commands</span>
            <div className="hotkey-panel-header-actions">
              <button
                className="hotkey-edit"
                onMouseDown={(e) => {
                  e.stopPropagation()
                  onEditProject()
                }}
                title="Edit project details"
              >
                ⚙
              </button>
              <button
                className={`hotkey-pin${pinned ? ' active' : ''}`}
                onMouseDown={(e) => {
                  e.stopPropagation()
                  onTogglePinned()
                }}
                title={pinned ? 'Unpin (auto-collapses again on refocus)' : 'Pin open (stays open on refocus)'}
              >
                📌
              </button>
              <button className="hotkey-close" onMouseDown={onToggleExpanded} title="Collapse (Esc)">
                ×
              </button>
            </div>
          </div>
          <div className="hotkey-panel-rows">
            {config.commands.length === 0 ? (
              <div className="hotkey-panel-empty">No commands configured for this project.</div>
            ) : (
              config.commands.map((c) => {
                const target = findCommandTarget(c, config)
                const isArmed = armed?.id === c.id
                return (
                  <button
                    key={c.id}
                    className={`hotkey-row${c.dangerous ? ' dangerous' : ''}${isArmed ? ' armed' : ''}`}
                    onMouseDown={() => onRunCommand(c)}
                  >
                    <span className="hotkey-row-key">{c.hotkey ?? '—'}</span>
                    <span className="hotkey-row-label">
                      {c.label}
                      {c.dangerous && <span className="hotkey-row-dangerous-mark" title="Arm-to-confirm required" />}
                    </span>
                    {target && <span className="hotkey-row-target">{target.host}</span>}
                  </button>
                )
              })
            )}
          </div>
        </div>
      ) : (
        <div className="hotkey-rail" onMouseDown={onToggleExpanded} title="Show command list (Ctrl+/)">
          <span className="hotkey-rail-toggle">⋮</span>
          {hotkeyed.map((c) => (
            <span key={c.id} className={`hotkey-rail-badge${c.dangerous ? ' dangerous' : ''}`}>
              {hotkeyGlyph(c.hotkey!)}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
