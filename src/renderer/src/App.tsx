import { useCallback, useEffect, useRef, useState } from 'react'
import TabStrip from './TabStrip'
import SplitPane from './SplitPane'
import {
  findLeaves,
  removeLeaf,
  replaceNode,
  updateSplitSizes,
  type Tab,
  type PaneNode
} from './types'

let idCounter = 0
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${idCounter++}`

function makeTab(cwd: string): Tab {
  const leafId = nextId('pane')
  return {
    id: nextId('tab'),
    title: 'PowerShell',
    root: { type: 'leaf', id: leafId, cwd },
    activePaneId: leafId
  }
}

export default function App(): JSX.Element {
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const [homeDir, setHomeDir] = useState<string>('')
  const restored = useRef(false)

  // Restore session on first mount (terminal working directories only —
  // scrollback restore is explicitly not required, per spec §4).
  useEffect(() => {
    ;(async () => {
      const home = await window.shinshell.system.homeDir()
      setHomeDir(home)

      const saved = await window.shinshell.session.load()
      if (saved.tabs.length > 0) {
        const restoredTabs = saved.tabs.map((t) => makeTab(t.cwd))
        setTabs(restoredTabs)
        const active = saved.activeTabId
          ? restoredTabs[saved.tabs.findIndex((t) => t.id === saved.activeTabId)]
          : restoredTabs[0]
        setActiveTabId((active ?? restoredTabs[0]).id)
      } else {
        const tab = makeTab(home)
        setTabs([tab])
        setActiveTabId(tab.id)
      }
      restored.current = true
    })()
  }, [])

  // Persist session (tab cwds only) whenever the tab set changes.
  useEffect(() => {
    if (!restored.current) return
    window.shinshell.session.save({
      tabs: tabs.map((t) => {
        const activeLeaf = findLeaves(t.root).find((l) => l.id === t.activePaneId) ?? findLeaves(t.root)[0]
        return { id: t.id, cwd: activeLeaf.cwd }
      }),
      activeTabId
    })
  }, [tabs, activeTabId])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const newTab = useCallback(() => {
    const tab = makeTab(homeDir)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [homeDir])

  const closeTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === tabId)
        if (idx === -1) return prev
        const next = prev.filter((t) => t.id !== tabId)
        if (tabId === activeTabId && next.length > 0) {
          setActiveTabId(next[Math.max(0, idx - 1)].id)
        }
        return next
      })
    },
    [activeTabId]
  )

  const focusPane = useCallback(
    (paneId: string) => {
      if (!activeTab) return
      setTabs((prev) => prev.map((t) => (t.id === activeTab.id ? { ...t, activePaneId: paneId } : t)))
    },
    [activeTab]
  )

  const resizeSplit = useCallback(
    (splitId: string, sizes: [number, number]) => {
      if (!activeTab) return
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id ? { ...t, root: updateSplitSizes(t.root, splitId, sizes) } : t))
      )
    },
    [activeTab]
  )

  const splitActivePane = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (!activeTab) return
      const leaves = findLeaves(activeTab.root)
      const current = leaves.find((l) => l.id === activeTab.activePaneId) ?? leaves[0]
      const newLeafId = nextId('pane')
      const splitNode: PaneNode = {
        type: 'split',
        id: nextId('split'),
        direction,
        children: [current, { type: 'leaf', id: newLeafId, cwd: current.cwd }],
        sizes: [50, 50]
      }
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id
            ? { ...t, root: replaceNode(t.root, current.id, splitNode), activePaneId: newLeafId }
            : t
        )
      )
    },
    [activeTab]
  )

  const closeActivePane = useCallback(() => {
    if (!activeTab) return
    const leaves = findLeaves(activeTab.root)
    if (leaves.length <= 1) {
      closeTab(activeTab.id)
      return
    }
    const pruned = removeLeaf(activeTab.root, activeTab.activePaneId)
    if (!pruned) return
    const remainingLeaves = findLeaves(pruned)
    setTabs((prev) =>
      prev.map((t) =>
        t.id === activeTab.id ? { ...t, root: pruned, activePaneId: remainingLeaves[0].id } : t
      )
    )
  }, [activeTab, closeTab])

  // Global hotkeys scoped to this window (§8): new tab, close pane/tab, splits.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (!e.ctrlKey) return
      if (e.key === 't' || e.key === 'T') {
        e.preventDefault()
        newTab()
      } else if (e.key === 'w' || e.key === 'W') {
        e.preventDefault()
        closeActivePane()
      } else if (e.key === 'Tab') {
        e.preventDefault()
        setTabs((prev) => {
          if (prev.length === 0) return prev
          const idx = prev.findIndex((t) => t.id === activeTabId)
          const next = prev[(idx + 1) % prev.length]
          setActiveTabId(next.id)
          return prev
        })
      } else if (e.shiftKey && e.key === '\\') {
        e.preventDefault()
        splitActivePane('vertical')
      } else if (e.key === '\\') {
        e.preventDefault()
        splitActivePane('horizontal')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTabId, newTab, closeActivePane, splitActivePane])

  if (!activeTab) {
    return <div className="app-loading">Loading ShinShell…</div>
  }

  return (
    <div className="app">
      <TabStrip tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onNew={newTab} />
      {/* All tabs stay mounted (hidden via CSS, not unmounted) so switching
          tabs never tears down a live pty — only explicit close does. */}
      {tabs.map((t) => (
        <div key={t.id} className="pane-area" style={{ display: t.id === activeTabId ? 'flex' : 'none' }}>
          <SplitPane
            node={t.root}
            activePaneId={t.id === activeTabId ? t.activePaneId : ''}
            onFocusPane={t.id === activeTabId ? focusPane : () => {}}
            onResize={t.id === activeTabId ? resizeSplit : () => {}}
          />
        </div>
      ))}
    </div>
  )
}
