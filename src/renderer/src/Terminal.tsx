import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'

interface TerminalProps {
  paneId: string
  cwd: string
  active: boolean
}

export default function TerminalPane({ paneId, cwd, active }: TerminalProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const xterm = new XTerm({
      // "NF" = Nerd Font variant — required for Oh-My-Posh's icon glyphs
      // (Private Use Area codepoints) to render instead of tofu boxes.
      // Confirmed installed on this machine; see docs/DISCOVERY.md §5.5.
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

    let disposed = false
    let offData = (): void => {}
    let offExit = (): void => {}
    let onInput = { dispose: (): void => {} }
    let resizeObserver: ResizeObserver | null = null

    // Defer the initial fit+spawn to after the browser has finished layout.
    // Fitting synchronously (e.g. right after mount, especially when several
    // tabs mount in the same commit) can measure a container before its
    // final flex size settles, so the *next* real layout pass — landing via
    // ResizeObserver — reports a different size and triggers a genuine
    // resize right after spawn. ConPTY/PSReadLine redraw the prompt on
    // resize (correct behavior), which reads as a duplicated prompt when it
    // happens moments after the shell's first prompt already printed.
    requestAnimationFrame(() => {
      if (disposed) return
      fitAddon.fit()

      window.shinshell.pty.spawn({
        id: paneId,
        cwd,
        cols: xterm.cols,
        rows: xterm.rows
      })

      offData = window.shinshell.pty.onData(({ id, data }) => {
        if (id === paneId) xterm.write(data)
      })
      offExit = window.shinshell.pty.onExit(({ id }) => {
        if (id === paneId) xterm.write('\r\n[process exited]\r\n')
      })
      onInput = xterm.onData((data) => window.shinshell.pty.write(paneId, data))

      // ResizeObserver fires once immediately on observe() with the current
      // size — guard on an actual change so we don't send a redundant
      // resize for the size we just fit+spawned with above.
      let lastCols = xterm.cols
      let lastRows = xterm.rows
      resizeObserver = new ResizeObserver(() => {
        fitAddon.fit()
        if (xterm.cols === lastCols && xterm.rows === lastRows) return
        lastCols = xterm.cols
        lastRows = xterm.rows
        window.shinshell.pty.resize(paneId, xterm.cols, xterm.rows)
      })
      resizeObserver.observe(container)
    })

    return () => {
      disposed = true
      offData()
      offExit()
      onInput.dispose()
      resizeObserver?.disconnect()
      window.shinshell.pty.kill(paneId)
      xterm.dispose()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneId])

  // Re-fit when a previously *hidden* (display:none) tab becomes active —
  // its container had zero size while hidden, so the fit computed during
  // spawn may be stale. Skipped on the initial mount: a tab that's already
  // active at mount time was never hidden, and re-fitting there duplicates
  // the fit done by the spawn effect above, which — for reasons not fully
  // root-caused — caused Oh-My-Posh to redraw and print its prompt twice.
  const mountedRef = useRef(false)
  useEffect(() => {
    if (active && mountedRef.current) {
      fitRef.current?.fit()
    }
    if (active) xtermRef.current?.focus()
    mountedRef.current = true
  }, [active])

  return <div ref={containerRef} className="terminal-pane" />
}
