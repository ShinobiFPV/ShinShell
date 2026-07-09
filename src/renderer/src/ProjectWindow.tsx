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
import type { ProjectConfig, ProjectCommand } from '../../shared/project'
import { substituteVariables } from '../../shared/commandSubstitution'
import { matchesHotkey, findHotkeyConflicts } from './hotkeys'
import AdminBadge from './AdminBadge'

let idCounter = 0
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${idCounter++}`

function makeTab(cwd: string): Tab {
  const leafId = nextId('pane')
  return {
    id: nextId('tab'),
    title: 'Terminal',
    root: { type: 'leaf', id: leafId, cwd },
    activePaneId: leafId
  }
}

interface ProjectWindowProps {
  projectId: string
}

export default function ProjectWindow({ projectId }: ProjectWindowProps): JSX.Element {
  const [config, setConfig] = useState<ProjectConfig | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const restored = useRef(false)
  const initialCommandsRef = useRef(new Map<string, string>())

  // Load the project config, then restore its saved tabs (cwd only — no
  // scrollback, per spec §4) or fall back to a single tab in workingDir.
  useEffect(() => {
    ;(async () => {
      const cfg = await window.shinshell.projects.get(projectId)
      if (!cfg) return
      setConfig(cfg)
      document.title = cfg.name

      if (cfg.restore.tabs.length > 0) {
        const restoredTabs = cfg.restore.tabs.map((t) => makeTab(t.cwd))
        setTabs(restoredTabs)
        const activeIdx = cfg.restore.activeTabId
          ? cfg.restore.tabs.findIndex((t) => t.id === cfg.restore.activeTabId)
          : 0
        setActiveTabId(restoredTabs[Math.max(0, activeIdx)].id)
      } else {
        const tab = makeTab(cfg.workingDir)
        setTabs([tab])
        setActiveTabId(tab.id)
      }
      restored.current = true
    })()
  }, [projectId])

  // Persist restore state (tab cwds only) into this project's own config.
  useEffect(() => {
    if (!restored.current) return
    window.shinshell.projects.saveRestoreState(projectId, {
      tabs: tabs.map((t) => {
        const activeLeaf = findLeaves(t.root).find((l) => l.id === t.activePaneId) ?? findLeaves(t.root)[0]
        return { id: t.id, cwd: activeLeaf.cwd }
      }),
      activeTabId
    })
  }, [projectId, tabs, activeTabId])

  // Conflict detection (§8: "editable in settings with conflict detection")
  // — no settings UI exists yet, so conflicts surface via console.warn
  // (visible in DevTools) rather than blocking the (human-editable, §3)
  // config from loading.
  useEffect(() => {
    if (!config) return
    for (const conflict of findHotkeyConflicts(config)) {
      console.warn(`[ShinShell] Hotkey conflict in "${config.name}": ${conflict}`)
    }
  }, [config])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const newTab = useCallback(() => {
    if (!config) return
    const tab = makeTab(config.workingDir)
    setTabs((prev) => [...prev, tab])
    setActiveTabId(tab.id)
  }, [config])

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

  // Executes a saved command per its runIn (§7/§8):
  //  - "new-tab": open a fresh terminal tab and type the command + Enter.
  //  - "active-terminal": type into the focused pane's input, cursor left at
  //    the end — NOT executed, so the user can review/edit first.
  //  - "background": fire via the main process, no visible terminal (no
  //    output surface yet — that's the deploy tab, §6.7/M6).
  const runCommand = useCallback(
    (cmd: ProjectCommand) => {
      if (!config) return
      const substituted = substituteVariables(cmd.command, config)
      if (cmd.runIn === 'new-tab') {
        const tab = makeTab(config.workingDir)
        initialCommandsRef.current.set(tab.activePaneId, substituted)
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
      } else if (cmd.runIn === 'active-terminal') {
        if (!activeTab) return
        window.shinshell.pty.write(activeTab.activePaneId, substituted)
      } else if (cmd.runIn === 'background') {
        window.shinshell.commands.runBackground({
          command: substituted,
          cwd: config.workingDir,
          shell: config.shell,
          env: config.env
        })
      }
    },
    [config, activeTab]
  )

  // Global Ctrl+Alt+T (§8) — new terminal tab in whichever project window
  // last had focus, sent from the main process.
  useEffect(() => window.shinshell.window.onNewTerminalTab(() => newTab()), [newTab])

  // Project-scoped hotkeys (§8): new tab, close pane/tab, cycle tabs, splits,
  // and each saved command's own hotkey.
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
      } else {
        const cmd = config?.commands.find((c) => c.hotkey && matchesHotkey(e, c.hotkey))
        if (cmd) {
          e.preventDefault()
          runCommand(cmd)
        }
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [activeTabId, newTab, closeActivePane, splitActivePane, config, runCommand])

  if (!config || !activeTab) {
    return <div className="app-loading">Loading project…</div>
  }

  const accentStyle = { '--accent': config.accentColor } as React.CSSProperties

  return (
    <div className="app" style={accentStyle}>
      <div className="tab-strip-row">
        <TabStrip tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onNew={newTab} />
        <AdminBadge />
      </div>
      {/* All tabs stay mounted (hidden via CSS, not unmounted) so switching
          tabs never tears down a live pty — only explicit close does. */}
      {tabs.map((t) => (
        <div key={t.id} className="pane-area" style={{ display: t.id === activeTabId ? 'flex' : 'none' }}>
          <SplitPane
            node={t.root}
            activePaneId={t.id === activeTabId ? t.activePaneId : ''}
            shell={config.shell}
            env={config.env}
            initialCommands={initialCommandsRef.current}
            onFocusPane={t.id === activeTabId ? focusPane : () => {}}
            onResize={t.id === activeTabId ? resizeSplit : () => {}}
          />
        </div>
      ))}
    </div>
  )
}
