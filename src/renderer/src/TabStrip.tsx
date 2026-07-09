import type { Tab } from './types'

interface TabStripProps {
  tabs: Tab[]
  activeTabId: string
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNew: () => void
}

export default function TabStrip({ tabs, activeTabId, onSelect, onClose, onNew }: TabStripProps): JSX.Element {
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
      <button className="tab-new" onMouseDown={onNew} aria-label="New terminal tab">
        +
      </button>
    </div>
  )
}
