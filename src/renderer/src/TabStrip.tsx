import type { Tab, TabKind } from './types'

interface TabStripProps {
  tabs: Tab[]
  activeTabId: string
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTabKind: (kind: TabKind) => void
}

const NEW_TAB_OPTIONS: { kind: TabKind; label: string; title: string }[] = [
  { kind: 'terminal', label: '+Term', title: 'New terminal (Ctrl+T)' },
  { kind: 'claude-code', label: '+CC', title: 'New Claude Code terminal' },
  { kind: 'claude-chat', label: '+Chat', title: 'New Claude chat' },
  { kind: 'editor', label: '+Edit', title: 'New editor' },
  { kind: 'scratchpad', label: '+Pad', title: 'Open scratchpad' },
  { kind: 'log-tail', label: '+Log', title: 'Tail a command’s output' },
  { kind: 'deploy', label: '+Deploy', title: 'Open deploy tab' },
  { kind: 'ports', label: '+Ports', title: 'Open port panel' }
]

export default function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTabKind
}: TabStripProps): JSX.Element {
  return (
    <div className="tab-strip">
      {tabs.map((tab) => (
        <div
          key={tab.id}
          className={`tab${tab.id === activeTabId ? ' active' : ''}`}
          onMouseDown={() => onSelect(tab.id)}
        >
          <span className="tab-title">{tab.title}</span>
          <button
            className="tab-close"
            onMouseDown={(e) => {
              e.stopPropagation()
              onClose(tab.id)
            }}
            aria-label={`Close ${tab.title}`}
          >
            &times;
          </button>
        </div>
      ))}
      <div className="tab-new-group">
        {NEW_TAB_OPTIONS.map((opt) => (
          <button
            key={opt.kind}
            className="tab-new"
            title={opt.title}
            onMouseDown={() => onNewTabKind(opt.kind)}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  )
}
