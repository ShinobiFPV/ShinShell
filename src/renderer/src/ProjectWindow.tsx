import { useCallback, useEffect, useRef, useState } from 'react'
import TabStrip from './TabStrip'
import SplitPane from './SplitPane'
import ClaudeChatTab from './ClaudeChatTab'
import EditorTab from './EditorTab'
import ScratchpadTab from './ScratchpadTab'
import {
  findLeaves,
  removeLeaf,
  replaceNode,
  updateSplitSizes,
  isTerminalLike,
  type Tab,
  type TabKind,
  type PaneNode
} from './types'
import type { ProjectConfig, ProjectCommand, RestoredTab } from '../../shared/project'
import { substituteVariables } from '../../shared/commandSubstitution'
import { matchesHotkey, findHotkeyConflicts } from './hotkeys'
import AdminBadge from './AdminBadge'

let idCounter = 0
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${idCounter++}`

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function makeTerminalTab(cwd: string, kind: 'terminal' | 'claude-code' = 'terminal'): Tab {
  const leafId = nextId('pane')
  return {
    id: nextId('tab'),
    kind,
    title: kind === 'claude-code' ? 'Claude Code' : 'Terminal',
    root: { type: 'leaf', id: leafId, cwd },
    activePaneId: leafId
  }
}

function makeClaudeChatTab(): Tab {
  return { id: nextId('tab'), kind: 'claude-chat', title: 'Claude' }
}

function makeEditorTab(filePath: string | null): Tab {
  return { id: nextId('tab'), kind: 'editor', title: filePath ? basename(filePath) : 'Untitled', filePath }
}

function makeScratchpadTab(): Tab {
  return { id: nextId('tab'), kind: 'scratchpad', title: 'Scratchpad' }
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
  const dirtyEditorTabsRef = useRef(new Set<string>())

  // Load the project config, then restore its saved tabs (cwd/filePath only
  // — no scrollback/editor-content restore, per spec §4) or fall back to a
  // single terminal tab in workingDir.
  useEffect(() => {
    ;(async () => {
      const cfg = await window.shinshell.projects.get(projectId)
      if (!cfg) return
      setConfig(cfg)
      document.title = cfg.name

      if (cfg.restore.tabs.length > 0) {
        const restoredTabs = cfg.restore.tabs.map((t) => restoreTab(t, cfg.workingDir))
        setTabs(restoredTabs)
        const activeIdx = cfg.restore.activeTabId
          ? cfg.restore.tabs.findIndex((t) => t.id === cfg.restore.activeTabId)
          : 0
        setActiveTabId(restoredTabs[Math.max(0, activeIdx)].id)
      } else {
        const tab = makeTerminalTab(cfg.workingDir)
        setTabs([tab])
        setActiveTabId(tab.id)
      }
      restored.current = true
    })()
  }, [projectId])

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

  // Persist restore state (cwd/filePath only) into this project's own config.
  useEffect(() => {
    if (!restored.current) return
    window.shinshell.projects.saveRestoreState(projectId, {
      tabs: tabs.map(toRestoredTab),
      activeTabId
    })
  }, [projectId, tabs, activeTabId])

  const activeTab = tabs.find((t) => t.id === activeTabId)

  const newTabOfKind = useCallback(
    (kind: TabKind) => {
      if (!config) return
      if (kind === 'scratchpad') {
        const existing = tabs.find((t) => t.kind === 'scratchpad')
        if (existing) {
          setActiveTabId(existing.id)
          return
        }
      }
      const tab =
        kind === 'claude-chat'
          ? makeClaudeChatTab()
          : kind === 'editor'
            ? makeEditorTab(null)
            : kind === 'scratchpad'
              ? makeScratchpadTab()
              : makeTerminalTab(config.workingDir, kind)
      if (kind === 'claude-code' && isTerminalLike(tab)) {
        initialCommandsRef.current.set(tab.activePaneId, 'claude')
      }
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tab.id)
    },
    [config, tabs]
  )

  const newTab = useCallback(() => newTabOfKind('terminal'), [newTabOfKind])

  const closeTab = useCallback(
    (tabId: string) => {
      if (dirtyEditorTabsRef.current.has(tabId)) {
        if (!window.confirm('This editor tab has unsaved changes. Close it anyway?')) return
        dirtyEditorTabsRef.current.delete(tabId)
      }
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
      if (!activeTab || !isTerminalLike(activeTab)) return
      setTabs((prev) =>
        prev.map((t) => (t.id === activeTab.id && isTerminalLike(t) ? { ...t, activePaneId: paneId } : t))
      )
    },
    [activeTab]
  )

  const resizeSplit = useCallback(
    (splitId: string, sizes: [number, number]) => {
      if (!activeTab || !isTerminalLike(activeTab)) return
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTab.id && isTerminalLike(t) ? { ...t, root: updateSplitSizes(t.root, splitId, sizes) } : t
        )
      )
    },
    [activeTab]
  )

  const splitActivePane = useCallback(
    (direction: 'horizontal' | 'vertical') => {
      if (!activeTab || !isTerminalLike(activeTab)) return
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
          t.id === activeTab.id && isTerminalLike(t)
            ? { ...t, root: replaceNode(t.root, current.id, splitNode), activePaneId: newLeafId }
            : t
        )
      )
    },
    [activeTab]
  )

  const closeActivePane = useCallback(() => {
    if (!activeTab) return
    if (!isTerminalLike(activeTab)) {
      closeTab(activeTab.id)
      return
    }
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
        t.id === activeTab.id && isTerminalLike(t) ? { ...t, root: pruned, activePaneId: remainingLeaves[0].id } : t
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
        const tab = makeTerminalTab(config.workingDir)
        if (isTerminalLike(tab)) initialCommandsRef.current.set(tab.activePaneId, substituted)
        setTabs((prev) => [...prev, tab])
        setActiveTabId(tab.id)
      } else if (cmd.runIn === 'active-terminal') {
        if (!activeTab || !isTerminalLike(activeTab)) return
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

  const updateTabTitle = useCallback((tabId: string, title: string) => {
    setTabs((prev) => prev.map((t) => (t.id === tabId ? { ...t, title } : t)))
  }, [])

  const updateEditorFilePath = useCallback(
    (tabId: string, path: string) => {
      updateTabTitle(tabId, basename(path))
      setTabs((prev) => prev.map((t) => (t.id === tabId && t.kind === 'editor' ? { ...t, filePath: path } : t)))
    },
    [updateTabTitle]
  )

  if (!config || !activeTab) {
    return <div className="app-loading">Loading project…</div>
  }

  const accentStyle = { '--accent': config.accentColor } as React.CSSProperties

  return (
    <div className="app" style={accentStyle}>
      <div className="tab-strip-row">
        <TabStrip tabs={tabs} activeTabId={activeTabId} onSelect={setActiveTabId} onClose={closeTab} onNewTabKind={newTabOfKind} />
        <AdminBadge />
      </div>
      {/* All tabs stay mounted (hidden via CSS, not unmounted) so switching
          tabs never tears down a live pty, browser session, or editor. */}
      {tabs.map((t) => {
        const active = t.id === activeTabId
        return (
          <div key={t.id} className="pane-area" style={{ display: active ? 'flex' : 'none' }}>
            {isTerminalLike(t) ? (
              <SplitPane
                node={t.root}
                activePaneId={active ? t.activePaneId : ''}
                shell={config.shell}
                env={config.env}
                initialCommands={initialCommandsRef.current}
                onFocusPane={active ? focusPane : () => {}}
                onResize={active ? resizeSplit : () => {}}
              />
            ) : t.kind === 'claude-chat' ? (
              <ClaudeChatTab tabId={t.id} active={active} />
            ) : t.kind === 'editor' ? (
              <EditorTab
                filePath={t.filePath}
                active={active}
                onFilePathChange={(path) => updateEditorFilePath(t.id, path)}
                onDirtyChange={(dirty) => {
                  if (dirty) dirtyEditorTabsRef.current.add(t.id)
                  else dirtyEditorTabsRef.current.delete(t.id)
                }}
              />
            ) : (
              <ScratchpadTab projectId={projectId} active={active} />
            )}
          </div>
        )
      })}
    </div>
  )
}

function restoreTab(t: RestoredTab, defaultCwd: string): Tab {
  switch (t.kind) {
    case 'claude-chat':
      return makeClaudeChatTab()
    case 'editor':
      return makeEditorTab(t.filePath ?? null)
    case 'scratchpad':
      return makeScratchpadTab()
    case 'claude-code':
      return makeTerminalTab(t.cwd || defaultCwd, 'claude-code')
    case 'terminal':
    default:
      return makeTerminalTab(t.cwd || defaultCwd, 'terminal')
  }
}

function toRestoredTab(t: Tab): RestoredTab {
  if (isTerminalLike(t)) {
    const activeLeaf = findLeaves(t.root).find((l) => l.id === t.activePaneId) ?? findLeaves(t.root)[0]
    return { id: t.id, kind: t.kind, cwd: activeLeaf.cwd }
  }
  if (t.kind === 'editor') {
    return { id: t.id, kind: 'editor', filePath: t.filePath ?? undefined }
  }
  return { id: t.id, kind: t.kind }
}
