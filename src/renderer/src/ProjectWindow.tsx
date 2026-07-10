import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import TabStrip from './TabStrip'
import SplitPane from './SplitPane'
import ClaudeChatTab from './ClaudeChatTab'
import EditorTab from './EditorTab'
import ScratchpadTab from './ScratchpadTab'
import LogTailTab from './LogTailTab'
import DeployTab from './DeployTab'
import PortsTab from './PortsTab'
import SshHealthLight from './SshHealthLight'
import CommandPalette, { type PaletteAction } from './CommandPalette'
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
import { substituteVariables, findCommandTarget } from '../../shared/commandSubstitution'
import { matchesHotkey, findHotkeyConflicts } from './hotkeys'
import AdminBadge from './AdminBadge'
import ArmedCommandBanner from './ArmedCommandBanner'
import Toast, { type ToastMessage } from './Toast'
import HotkeySidebar from './HotkeySidebar'
import EditProjectDialog from './EditProjectDialog'
import { refitAllTerminals } from './terminalRegistry'

const FOCUS_REVALIDATE_DEBOUNCE_MS = 300

let idCounter = 0
const nextId = (prefix: string): string => `${prefix}-${Date.now()}-${idCounter++}`

// §UX2 — arm-to-confirm: a dangerous command's first trigger only arms it;
// the same trigger within this window fires it, otherwise it silently disarms.
const ARM_WINDOW_MS = 3000

export interface ArmedCommand {
  id: string
  summary: string
  expiresAt: number
}

// "Deploy + Restart Q2 → shinobi" (§UX2).
function commandSummary(cmd: ProjectCommand, config: ProjectConfig): string {
  const target = findCommandTarget(cmd, config)
  return target ? `${cmd.label} → ${target.host}` : cmd.label
}

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

function makeDeployTab(): Tab {
  return { id: nextId('tab'), kind: 'deploy', title: 'Deploy' }
}

function makePortsTab(): Tab {
  return { id: nextId('tab'), kind: 'ports', title: 'Ports' }
}

function makeLogTailTab(commandId: string, label: string): Tab {
  return { id: nextId('tab'), kind: 'log-tail', title: label, commandId }
}

interface ProjectWindowProps {
  projectId: string
}

export default function ProjectWindow({ projectId }: ProjectWindowProps): JSX.Element {
  const [config, setConfig] = useState<ProjectConfig | null>(null)
  const [tabs, setTabs] = useState<Tab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>('')
  const [logPickerOpen, setLogPickerOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [otherProjects, setOtherProjects] = useState<ProjectConfig[]>([])
  const [armed, setArmed] = useState<ArmedCommand | null>(null)
  const [failedTabIds, setFailedTabIds] = useState<Set<string>>(new Set())
  const [toasts, setToasts] = useState<ToastMessage[]>([])
  const [sidebarExpanded, setSidebarExpanded] = useState(false)
  const [sidebarPinned, setSidebarPinned] = useState(false)
  const [pathValid, setPathValid] = useState(true)
  const [editDialogOpen, setEditDialogOpen] = useState(false)
  const restored = useRef(false)
  const initialCommandsRef = useRef(new Map<string, string>())
  const dirtyEditorTabsRef = useRef(new Set<string>())
  const focusRevalidateTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

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
        const restoredTabs = cfg.restore.tabs.map((t) => restoreTab(t, cfg))
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

  // § path validation — checked when the window opens, re-checked on focus
  // (a rename made while this window was in the background, e.g. via
  // Explorer, surfaces without polling), and refreshed immediately whenever
  // an edit is saved (either from this window's own dialog or the launcher's).
  useEffect(() => {
    window.shinshell.projects.validate(projectId).then((v) => setPathValid(v.valid))
  }, [projectId])

  useEffect(() => {
    const onFocus = (): void => {
      if (focusRevalidateTimer.current) clearTimeout(focusRevalidateTimer.current)
      focusRevalidateTimer.current = setTimeout(() => {
        window.shinshell.projects.validate(projectId).then((v) => setPathValid(v.valid))
      }, FOCUS_REVALIDATE_DEBOUNCE_MS)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      if (focusRevalidateTimer.current) clearTimeout(focusRevalidateTimer.current)
    }
  }, [projectId])

  useEffect(
    () =>
      window.shinshell.projects.onUpdated((updated) => {
        if (updated.id !== projectId) return
        setConfig(updated)
        setPathValid(true) // a save only succeeds against a valid workingDir
      }),
    [projectId]
  )

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

  // § path validation — the single gate every "this uses workingDir and is
  // about to spawn a pty" action goes through. Existing tabs/ptys are never
  // touched by this; it only blocks creating new ones while the folder is
  // missing, with a toast pointing at the fix.
  const guardPathValid = useCallback((): boolean => {
    if (pathValid) return true
    setToasts((prev) => [
      ...prev,
      {
        id: nextId('toast'),
        text: 'Project folder not found — use Edit project details to fix the path',
        kind: 'failure'
      }
    ])
    return false
  }, [pathValid])

  const newTabOfKind = useCallback(
    (kind: TabKind) => {
      if (!config) return
      if ((kind === 'terminal' || kind === 'claude-code' || kind === 'log-tail') && !guardPathValid()) return
      if (kind === 'log-tail') {
        if (config.commands.length === 0) return
        setLogPickerOpen(true)
        return
      }
      if (kind === 'scratchpad' || kind === 'deploy' || kind === 'ports') {
        const existing = tabs.find((t) => t.kind === kind)
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
              : kind === 'deploy'
                ? makeDeployTab()
                : kind === 'ports'
                  ? makePortsTab()
                  : makeTerminalTab(config.workingDir, kind)
      if (kind === 'claude-code' && isTerminalLike(tab)) {
        initialCommandsRef.current.set(tab.activePaneId, 'claude')
      }
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tab.id)
    },
    [config, tabs, guardPathValid]
  )

  const newTab = useCallback(() => newTabOfKind('terminal'), [newTabOfKind])

  const createLogTailTab = useCallback(
    (cmd: ProjectCommand) => {
      if (!guardPathValid()) return
      const tab = makeLogTailTab(cmd.id, cmd.label)
      setTabs((prev) => [...prev, tab])
      setActiveTabId(tab.id)
      setLogPickerOpen(false)
    },
    [guardPathValid]
  )

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
      // §UX4 — refocusing the terminal auto-collapses the hotkey sidebar,
      // unless the user pinned it open.
      setSidebarExpanded((expanded) => (expanded && !sidebarPinned ? false : expanded))
    },
    [activeTab, sidebarPinned]
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

  // §UX1 — SHINSHELL_PROJECT/SHINSHELL_ACCENT ride into every pty this window
  // spawns so an Oh-My-Posh segment (paradox.omp.json) can render the project
  // name in its accent color inside the prompt itself, not just window chrome.
  const shellEnv = useMemo(
    () =>
      config
        ? { ...config.env, SHINSHELL_PROJECT: config.name, SHINSHELL_ACCENT: config.accentColor }
        : {},
    [config]
  )

  // Executes a saved command per its runIn (§7/§8):
  //  - "new-tab": open a fresh terminal tab and type the command + Enter.
  //  - "active-terminal": type into the focused pane's input, cursor left at
  //    the end — NOT executed, so the user can review/edit first.
  //  - "background": fire via the main process, no visible terminal.
  const executeCommand = useCallback(
    (cmd: ProjectCommand) => {
      if (!config) return
      // "active-terminal" only types into an already-live pty (no new
      // process, no path involved) so it's exempt — "new-tab" and
      // "background" both spawn against workingDir and go through the gate.
      if ((cmd.runIn === 'new-tab' || cmd.runIn === 'background') && !guardPathValid()) return
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
          env: shellEnv
        })
      }
    },
    [config, activeTab, shellEnv, guardPathValid]
  )

  // §UX2 — gate for any dangerous command trigger (hotkey, palette, or a tab's
  // own button). Re-triggering the same armed command within ARM_WINDOW_MS
  // fires it; any other trigger (re)arms instead of running.
  const requestConfirm = useCallback(
    (cmd: ProjectCommand, execute: () => void) => {
      if (!config) return
      setArmed((prev) => {
        if (prev && prev.id === cmd.id && Date.now() < prev.expiresAt) {
          execute()
          return null
        }
        return { id: cmd.id, summary: commandSummary(cmd, config), expiresAt: Date.now() + ARM_WINDOW_MS }
      })
    },
    [config]
  )

  // Auto-disarm: silently drops the armed command once its window expires.
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => {
      setArmed((prev) => (prev && prev.expiresAt <= Date.now() ? null : prev))
    }, Math.max(0, armed.expiresAt - Date.now()))
    return () => clearTimeout(timer)
  }, [armed])

  const runCommand = useCallback(
    (cmd: ProjectCommand) => {
      if (cmd.dangerous) requestConfirm(cmd, () => executeCommand(cmd))
      else executeCommand(cmd)
    },
    [executeCommand, requestConfirm]
  )

  // §UX3 — a reselected tab has been "looked at," so its failure glow clears
  // regardless of which code path changed activeTabId.
  useEffect(() => {
    if (!activeTabId) return
    setFailedTabIds((prev) => {
      if (!prev.has(activeTabId)) return prev
      const next = new Set(prev)
      next.delete(activeTabId)
      return next
    })
  }, [activeTabId])

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleDeployRunStart = useCallback(() => {
    window.shinshell.window.setProgress(2) // indeterminate — duration unknown ahead of time
  }, [])

  const handleDeployRunEnd = useCallback(
    (exitCode: number) => {
      window.shinshell.window.setProgress(null)
      window.shinshell.window.flash()
      if (exitCode !== 0) {
        const deployTabId = tabs.find((t) => t.kind === 'deploy')?.id
        if (deployTabId) setFailedTabIds((prev) => new Set(prev).add(deployTabId))
      }
      setToasts((prev) => [
        ...prev,
        {
          id: nextId('toast'),
          text: exitCode === 0 ? 'Deploy finished' : `Deploy failed (exit ${exitCode})`,
          kind: exitCode === 0 ? 'success' : 'failure'
        }
      ])
    },
    [tabs]
  )

  // Global Ctrl+Alt+T (§8) — new terminal tab in whichever project window
  // last had focus, sent from the main process.
  useEffect(() => window.shinshell.window.onNewTerminalTab(() => newTab()), [newTab])

  // Responsive resizing — window moved to a different-DPI monitor, or a
  // display's scale factor changed underneath it (windows.ts). CSS layout
  // doesn't change size in that case, so terminals need an explicit nudge.
  useEffect(() => window.shinshell.window.onDisplayChanged(() => refitAllTerminals()), [])

  // Refresh the "switch to project" list whenever the palette opens, rather
  // than keeping it live-subscribed the whole time a window is open.
  useEffect(() => {
    if (!paletteOpen) return
    window.shinshell.projects.list().then((all) => setOtherProjects(all.filter((p) => p.id !== projectId)))
  }, [paletteOpen, projectId])

  // §6.11 — command palette action list: saved commands, tab actions, and
  // project switching, in one flat searchable list.
  const paletteActions = useMemo<PaletteAction[]>(() => {
    if (!config) return []
    const actions: PaletteAction[] = config.commands.map((cmd) => ({
      id: `cmd-${cmd.id}`,
      category: 'Command',
      label: cmd.label,
      run: () => runCommand(cmd)
    }))
    actions.push(
      { id: 'tab-terminal', category: 'Tab', label: 'New Terminal', run: () => newTabOfKind('terminal') },
      { id: 'tab-claude-code', category: 'Tab', label: 'New Claude Code', run: () => newTabOfKind('claude-code') },
      { id: 'tab-claude-chat', category: 'Tab', label: 'New Claude Chat', run: () => newTabOfKind('claude-chat') },
      { id: 'tab-editor', category: 'Tab', label: 'New Editor', run: () => newTabOfKind('editor') },
      { id: 'tab-log-tail', category: 'Tab', label: 'Tail a Command…', run: () => newTabOfKind('log-tail') },
      { id: 'tab-scratchpad', category: 'Tab', label: 'Open Scratchpad', run: () => newTabOfKind('scratchpad') },
      { id: 'tab-deploy', category: 'Tab', label: 'Open Deploy Tab', run: () => newTabOfKind('deploy') },
      { id: 'tab-ports', category: 'Tab', label: 'Open Ports Panel', run: () => newTabOfKind('ports') },
      { id: 'tab-close', category: 'Tab', label: 'Close Active Tab', run: () => closeActivePane() },
      { id: 'edit-project', category: 'Project', label: 'Edit project details', run: () => setEditDialogOpen(true) },
      { id: 'check-updates', category: 'App', label: 'Check for updates', run: () => window.shinshell.updater.check() }
    )
    for (const p of otherProjects) {
      actions.push({
        id: `project-${p.id}`,
        category: 'Project',
        label: `Switch to ${p.name}`,
        run: () => window.shinshell.window.openProject(p.id)
      })
    }
    return actions
  }, [config, otherProjects, runCommand, newTabOfKind, closeActivePane])

  // Project-scoped hotkeys (§8): new tab, close pane/tab, cycle tabs, splits,
  // command palette, and each saved command's own hotkey.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      // §UX4 — Esc always closes the hotkey sidebar (a deliberate dismiss,
      // unlike the passive auto-collapse-on-refocus, so it applies even
      // pinned) and doesn't fall through to any other binding.
      if (e.key === 'Escape' && sidebarExpanded) {
        e.preventDefault()
        setSidebarExpanded(false)
        return
      }
      if (!e.ctrlKey) return
      if (e.key === '/') {
        e.preventDefault()
        setSidebarExpanded((v) => !v)
      } else if (e.shiftKey && (e.key === 'p' || e.key === 'P')) {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      } else if (e.key === 't' || e.key === 'T') {
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
      } else if (e.shiftKey && e.code === 'Backslash') {
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
  }, [activeTabId, newTab, closeActivePane, splitActivePane, config, runCommand, sidebarExpanded])

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
  const hasHealthTarget = config.targets.length > 0

  return (
    <div className="app" style={accentStyle}>
      {/* Layout contract: this row holds exactly three things — the tab
          strip, the SSH health dot, and the ADMIN badge. Nothing else gets
          added here; anything else belongs in a tab, the sidebar, or a
          tooltip. */}
      <div className="tab-strip-row">
        <TabStrip
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNewTabKind={newTabOfKind}
          failedTabIds={failedTabIds}
        />
        <SshHealthLight projectId={projectId} hasTarget={hasHealthTarget} />
        <AdminBadge />
      </div>
      {armed && <ArmedCommandBanner summary={armed.summary} />}
      <Toast toasts={toasts} onDismiss={dismissToast} />
      {paletteOpen && <CommandPalette actions={paletteActions} onClose={() => setPaletteOpen(false)} />}
      {logPickerOpen && (
        <div className="command-picker-backdrop" onMouseDown={() => setLogPickerOpen(false)}>
          <div className="command-picker" onMouseDown={(e) => e.stopPropagation()}>
            <div className="command-picker-title">Tail which command?</div>
            {config.commands.map((c) => (
              <button key={c.id} className="command-picker-item" onMouseDown={() => createLogTailTab(c)}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="content-area">
        {/* Flex sibling of the sidebar, not a positioning parent for it — so
            expanding/pinning the sidebar shrinks this and every terminal
            inside it reflows via its own ResizeObserver (Terminal.tsx). */}
        <div className="tab-content-wrapper">
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
                    env={shellEnv}
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
                    pathValid={pathValid}
                    guardPathValid={guardPathValid}
                    onFilePathChange={(path) => updateEditorFilePath(t.id, path)}
                    onDirtyChange={(dirty) => {
                      if (dirty) dirtyEditorTabsRef.current.add(t.id)
                      else dirtyEditorTabsRef.current.delete(t.id)
                    }}
                  />
                ) : t.kind === 'scratchpad' ? (
                  <ScratchpadTab projectId={projectId} active={active} />
                ) : t.kind === 'deploy' ? (
                  <DeployTab
                    projectId={projectId}
                    config={{ ...config, env: shellEnv }}
                    active={active}
                    armed={armed}
                    pathValid={pathValid}
                    guardPathValid={guardPathValid}
                    requestConfirm={requestConfirm}
                    onRunStart={handleDeployRunStart}
                    onRunEnd={handleDeployRunEnd}
                  />
                ) : t.kind === 'ports' ? (
                  <PortsTab projectPorts={config.ports} />
                ) : (
                  (() => {
                    const cmd = config.commands.find((c) => c.id === t.commandId)
                    if (!cmd) return <div className="app-loading">Command no longer exists in project config.</div>
                    return (
                      <LogTailTab
                        tabId={t.id}
                        command={substituteVariables(cmd.command, config)}
                        cwd={config.workingDir}
                        shell={config.shell}
                        env={shellEnv}
                        active={active}
                      />
                    )
                  })()
                )}
              </div>
            )
          })}
        </div>
        <HotkeySidebar
          config={config}
          armed={armed}
          expanded={sidebarExpanded}
          pinned={sidebarPinned}
          onRunCommand={runCommand}
          onToggleExpanded={() => setSidebarExpanded((v) => !v)}
          onTogglePinned={() => setSidebarPinned((v) => !v)}
          onEditProject={() => setEditDialogOpen(true)}
        />
      </div>
      {editDialogOpen && (
        <EditProjectDialog
          project={config}
          onClose={() => setEditDialogOpen(false)}
          onSaved={(updated) => {
            setConfig(updated)
            setPathValid(true)
          }}
        />
      )}
    </div>
  )
}

function restoreTab(t: RestoredTab, config: ProjectConfig): Tab {
  switch (t.kind) {
    case 'claude-chat':
      return makeClaudeChatTab()
    case 'editor':
      return makeEditorTab(t.filePath ?? null)
    case 'scratchpad':
      return makeScratchpadTab()
    case 'deploy':
      return makeDeployTab()
    case 'ports':
      return makePortsTab()
    case 'log-tail': {
      const cmd = config.commands.find((c) => c.id === t.commandId)
      return makeLogTailTab(t.commandId ?? '', cmd?.label ?? 'Log tail')
    }
    case 'claude-code':
      return makeTerminalTab(t.cwd || config.workingDir, 'claude-code')
    case 'terminal':
    default:
      return makeTerminalTab(t.cwd || config.workingDir, 'terminal')
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
  if (t.kind === 'log-tail') {
    return { id: t.id, kind: 'log-tail', commandId: t.commandId }
  }
  return { id: t.id, kind: t.kind }
}
