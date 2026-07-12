import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

interface LogTailTabProps {
  tabId: string
  command: string
  cwd: string
  shell: string
  env: Record<string, string>
  active: boolean
  /** § read-only visibility — the project command's own label (e.g. "Tail
   *  Q2 logs"), passed through to pty.spawn so ShinShell Remote can title
   *  this tab meaningfully instead of falling back to the cwd's basename. */
  label?: string
}

type ConnState = 'connecting' | 'connected' | 'disconnected'

// §6.6 — same spawn-on-first-ResizeObserver-callback pattern as Terminal.tsx
// (see its comments for why: avoids a double size-measurement race that
// causes duplicate prompt redraws). This tails a specific command rather
// than being a general interactive shell, and tracks connection state +
// offers reconnect instead.
export default function LogTailTab({
  tabId,
  command,
  cwd,
  shell,
  env,
  active,
  label
}: LogTailTabProps): JSX.Element {
  const [connState, setConnState] = useState<ConnState>('connecting')
  const [generation, setGeneration] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const paneId = `${tabId}-gen${generation}`

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const xterm = new XTerm({
      fontFamily: '"Cascadia Code NF", "Cascadia Mono NF", Consolas, monospace',
      fontSize: 13,
      cursorBlink: true,
      allowTransparency: false,
      theme: { background: '#0c0c0c' }
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(container)
    try {
      xterm.loadAddon(new WebglAddon())
    } catch {
      // WebGL unavailable — falls back to xterm's default (canvas) renderer.
    }
    xtermRef.current = xterm
    fitRef.current = fitAddon
    setConnState('connecting')

    let offData = (): void => {}
    let offExit = (): void => {}
    let spawned = false
    let lastCols = 0
    let lastRows = 0

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      if (!spawned) {
        spawned = true
        lastCols = xterm.cols
        lastRows = xterm.rows
        window.shinshell.pty.spawn({
          id: paneId,
          cwd,
          cols: xterm.cols,
          rows: xterm.rows,
          shell,
          env,
          tabKind: 'log-tail',
          label
        })
        offData = window.shinshell.pty.onData(({ id, data }) => {
          if (id !== paneId) return
          setConnState('connected')
          xterm.write(data)
        })
        offExit = window.shinshell.pty.onExit(({ id }) => {
          if (id !== paneId) return
          setConnState('disconnected')
          xterm.write('\r\n[disconnected]\r\n')
        })
        window.shinshell.pty.write(paneId, `${command}\r`)
        return
      }
      if (xterm.cols === lastCols && xterm.rows === lastRows) return
      lastCols = xterm.cols
      lastRows = xterm.rows
      window.shinshell.pty.resize(paneId, xterm.cols, xterm.rows)
    })
    resizeObserver.observe(container)

    return () => {
      offData()
      offExit()
      resizeObserver.disconnect()
      window.shinshell.pty.kill(paneId)
      xterm.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  useEffect(() => {
    if (active) fitRef.current?.fit()
  }, [active])

  const reconnect = (): void => setGeneration((g) => g + 1)

  return (
    <div className="log-tail-tab">
      <div className="log-tail-toolbar">
        <span className={`conn-dot conn-${connState}`} title={connState} />
        <span className="conn-label">{connState}</span>
        <button onClick={reconnect}>Reconnect</button>
        <span className="log-tail-command">{command}</span>
      </div>
      <div ref={containerRef} className="terminal-pane" />
    </div>
  )
}
