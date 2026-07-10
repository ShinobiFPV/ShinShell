import { useRef } from 'react'
import TerminalPane from './Terminal'
import type { PaneNode } from './types'

// Approximate xterm cell metrics for the terminal font/size in styles.css
// (13px Cascadia Mono NF) — SplitPane has no live xterm instance to measure
// exactly, so this converts the "min 20 cols / 6 rows" spec into a pixel
// floor for the divider drag. A rough constant is fine here: it only needs
// to keep a dragged pane from collapsing to something unreadable, not be
// pixel-exact.
const MIN_COLS = 20
const MIN_ROWS = 6
const CHAR_WIDTH_PX = 8
const CHAR_HEIGHT_PX = 18

interface SplitPaneProps {
  node: PaneNode
  activePaneId: string
  shell: string
  env: Record<string, string>
  initialCommands: Map<string, string>
  onFocusPane: (paneId: string) => void
  onResize: (splitId: string, sizes: [number, number]) => void
}

export default function SplitPane({
  node,
  activePaneId,
  shell,
  env,
  initialCommands,
  onFocusPane,
  onResize
}: SplitPaneProps): JSX.Element {
  if (node.type === 'leaf') {
    return (
      <div
        className={`pane-leaf${node.id === activePaneId ? ' active' : ''}`}
        onMouseDown={() => onFocusPane(node.id)}
      >
        <TerminalPane
          paneId={node.id}
          cwd={node.cwd}
          shell={shell}
          env={env}
          active={node.id === activePaneId}
          initialCommand={initialCommands.get(node.id)}
        />
      </div>
    )
  }

  return (
    <SplitContainer
      node={node}
      activePaneId={activePaneId}
      shell={shell}
      env={env}
      initialCommands={initialCommands}
      onFocusPane={onFocusPane}
      onResize={onResize}
    />
  )
}

function SplitContainer({
  node,
  activePaneId,
  shell,
  env,
  initialCommands,
  onFocusPane,
  onResize
}: SplitPaneProps & { node: Extract<PaneNode, { type: 'split' }> }): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)

  const isRow = node.direction === 'horizontal' // panes side-by-side

  const onDividerDown = (e: React.MouseEvent): void => {
    e.preventDefault()
    dragging.current = true
    const container = containerRef.current
    if (!container) return

    const onMove = (moveEvent: MouseEvent): void => {
      if (!dragging.current) return
      const rect = container.getBoundingClientRect()
      const total = isRow ? rect.width : rect.height
      const minPx = isRow ? MIN_COLS * CHAR_WIDTH_PX : MIN_ROWS * CHAR_HEIGHT_PX
      // If the pane is too small for even one side to hold its minimum,
      // split evenly rather than letting the ratio clamp go negative.
      const minRatio = total > 0 ? Math.min(0.5, minPx / total) : 0.15
      const ratio = isRow
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height
      const clamped = Math.min(1 - minRatio, Math.max(minRatio, ratio))
      onResize(node.id, [clamped * 100, (1 - clamped) * 100])
    }
    const onUp = (): void => {
      dragging.current = false
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  return (
    <div ref={containerRef} className={`split-container ${isRow ? 'row' : 'col'}`}>
      <div className="split-child" style={{ flexBasis: `${node.sizes[0]}%` }}>
        <SplitPane
          node={node.children[0]}
          activePaneId={activePaneId}
          shell={shell}
          env={env}
          initialCommands={initialCommands}
          onFocusPane={onFocusPane}
          onResize={onResize}
        />
      </div>
      <div className={`divider ${isRow ? 'divider-row' : 'divider-col'}`} onMouseDown={onDividerDown} />
      <div className="split-child" style={{ flexBasis: `${node.sizes[1]}%` }}>
        <SplitPane
          node={node.children[1]}
          activePaneId={activePaneId}
          shell={shell}
          env={env}
          initialCommands={initialCommands}
          onFocusPane={onFocusPane}
          onResize={onResize}
        />
      </div>
    </div>
  )
}
