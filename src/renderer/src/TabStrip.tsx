import { useEffect, useRef, useState } from 'react'
import { findLeaves, isTerminalLike, type Tab, type TabKind } from './types'
import type { GitStatus } from '../../shared/ipc'

interface TabStripProps {
  tabs: Tab[]
  activeTabId: string
  onSelect: (tabId: string) => void
  onClose: (tabId: string) => void
  onNewTabKind: (kind: TabKind) => void
  /** §UX3 — tabs whose last run failed; cleared once the tab is reselected. */
  failedTabIds: Set<string>
}

const GIT_POLL_INTERVAL_MS = 30_000

// §6.12 moved out of the top bar (layout contract) and into the tab it
// describes — a terminal tab's own cwd, not the whole project's workingDir,
// so a `cd`'d-elsewhere pane shows its own branch rather than the project root's.
function useGitBranch(cwd: string | null): GitStatus | null {
  const [status, setStatus] = useState<GitStatus | null>(null)

  useEffect(() => {
    if (!cwd) {
      setStatus(null)
      return
    }
    let cancelled = false
    const check = (): void => {
      window.shinshell.gitStatus.get(cwd).then((s) => {
        if (!cancelled) setStatus(s)
      })
    }
    check()
    const timer = setInterval(check, GIT_POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [cwd])

  return status
}

function TabRow({
  tab,
  active,
  failed,
  onSelect,
  onClose
}: {
  tab: Tab
  active: boolean
  failed: boolean
  onSelect: () => void
  onClose: () => void
}): JSX.Element {
  const cwd = isTerminalLike(tab) ? (findLeaves(tab.root).find((l) => l.id === tab.activePaneId)?.cwd ?? null) : null
  const git = useGitBranch(cwd)

  return (
    <div
      className={`tab${active ? ' active' : ''}${failed ? ' failed' : ''}`}
      onMouseDown={onSelect}
      title={tab.title}
    >
      <span className="tab-title">{tab.title}</span>
      {git && (
        <span className={`tab-git${git.dirty ? ' tab-git-dirty' : ''}`} title={git.dirty ? 'Uncommitted changes' : 'Clean'}>
          <span className="tab-git-dot" />
          {git.branch}
        </span>
      )}
      <button className="tab-close" onMouseDown={(e) => { e.stopPropagation(); onClose() }} aria-label={`Close ${tab.title}`}>
        &times;
      </button>
    </div>
  )
}

export default function TabStrip({
  tabs,
  activeTabId,
  onSelect,
  onClose,
  onNewTabKind,
  failedTabIds
}: TabStripProps): JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollLeft, setCanScrollLeft] = useState(false)
  const [canScrollRight, setCanScrollRight] = useState(false)

  const updateArrows = (): void => {
    const el = scrollRef.current
    if (!el) return
    setCanScrollLeft(el.scrollLeft > 0)
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1)
  }

  // Tabs must never wrap to a second row — instead the strip scrolls
  // horizontally, with arrows appearing only once content actually overflows.
  useEffect(() => {
    updateArrows()
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(updateArrows)
    ro.observe(el)
    el.addEventListener('scroll', updateArrows)
    return () => {
      ro.disconnect()
      el.removeEventListener('scroll', updateArrows)
    }
  }, [tabs.length])

  const scrollBy = (delta: number): void => scrollRef.current?.scrollBy({ left: delta, behavior: 'smooth' })

  return (
    <div className="tab-strip">
      {canScrollLeft && (
        <button className="tab-scroll-arrow" onMouseDown={() => scrollBy(-160)} aria-label="Scroll tabs left">
          &lsaquo;
        </button>
      )}
      <div className="tab-strip-scroll" ref={scrollRef}>
        {tabs.map((tab) => (
          <TabRow
            key={tab.id}
            tab={tab}
            active={tab.id === activeTabId}
            failed={failedTabIds.has(tab.id)}
            onSelect={() => onSelect(tab.id)}
            onClose={() => onClose(tab.id)}
          />
        ))}
      </div>
      {canScrollRight && (
        <button className="tab-scroll-arrow" onMouseDown={() => scrollBy(160)} aria-label="Scroll tabs right">
          &rsaquo;
        </button>
      )}
      <button className="tab-new" onMouseDown={() => onNewTabKind('terminal')} title="New terminal (Ctrl+T) — other tab kinds: Ctrl+Shift+P">
        +
      </button>
    </div>
  )
}
