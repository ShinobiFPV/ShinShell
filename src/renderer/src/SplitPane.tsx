import { useRef } from 'react'
import TerminalPane from './Terminal'
import type { PaneNode } from './types'

interface SplitPaneProps {
  node: PaneNode
  activePaneId: string
  shell: string
  env: Record<string, string>
  onFocusPane: (paneId: string) => void
  onResize: (splitId: string, sizes: [number, number]) => void
}

export default function SplitPane({
  node,
  activePaneId,
  shell,
  env,
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
      const ratio = isRow
        ? (moveEvent.clientX - rect.left) / rect.width
        : (moveEvent.clientY - rect.top) / rect.height
      const clamped = Math.min(0.85, Math.max(0.15, ratio))
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
          onFocusPane={onFocusPane}
          onResize={onResize}
        />
      </div>
    </div>
  )
}
