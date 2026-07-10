import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { registerTerminalRefit } from './terminalRegistry'

const RESIZE_DEBOUNCE_MS = 50

interface TerminalProps {
  paneId: string
  cwd: string
  shell: string
  env: Record<string, string>
  active: boolean
  /** Typed + Enter right after spawn — used for runIn:"new-tab" commands (§7/§8). */
  initialCommand?: string
}

export default function TerminalPane({
  paneId,
  cwd,
  shell,
  env,
  active,
  initialCommand
}: TerminalProps): JSX.Element {
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

    let offData = (): void => {}
    let offExit = (): void => {}
    let onInput = { dispose: (): void => {} }
    let spawned = false
    let lastCols = 0
    let lastRows = 0
    let resizeTimer: ReturnType<typeof setTimeout> | null = null

    const commitResize = (): void => {
      fitAddon.fit()
      if (xterm.cols === lastCols && xterm.rows === lastRows) return
      lastCols = xterm.cols
      lastRows = xterm.rows
      window.shinshell.pty.resize(paneId, xterm.cols, xterm.rows)
    }

    // Spawn on the *first* ResizeObserver callback rather than a separate
    // up-front fitAddon.fit(). Two independent size measurements (an early
    // fit() vs. whatever ResizeObserver reports once real layout settles)
    // can disagree — more so when another window/renderer is also under
    // load — and disagreeing means a genuine resize fires moments after
    // spawn. ConPTY/PSReadLine redraw the prompt on resize (correct
    // behavior), which reads as a duplicated prompt right after the shell's
    // first one. Using the observer's own first report for both the spawn
    // size and the resize baseline removes the race by construction: there
    // is only ever one measurement pathway. That first callback fires
    // immediately (spawn shouldn't wait on a debounce); every resize after
    // it is debounced ~50ms so a drag-resize or a sidebar slide animation
    // doesn't spam pty.resize on every intermediate frame.
    const resizeObserver = new ResizeObserver(() => {
      if (!spawned) {
        fitAddon.fit()
        spawned = true
        lastCols = xterm.cols
        lastRows = xterm.rows

        window.shinshell.pty.spawn({
          id: paneId,
          cwd,
          cols: xterm.cols,
          rows: xterm.rows,
          shell,
          env
        })

        offData = window.shinshell.pty.onData(({ id, data }) => {
          if (id === paneId) xterm.write(data)
        })
        offExit = window.shinshell.pty.onExit(({ id }) => {
          if (id === paneId) xterm.write('\r\n[process exited]\r\n')
        })
        onInput = xterm.onData((data) => window.shinshell.pty.write(paneId, data))
        if (initialCommand) window.shinshell.pty.write(paneId, `${initialCommand}\r`)
        return
      }
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(commitResize, RESIZE_DEBOUNCE_MS)
    })
    resizeObserver.observe(container)

    // A window dragged onto a differently-scaled monitor doesn't change the
    // container's CSS size, so ResizeObserver never fires — but the canvas
    // backing store still needs to be re-measured and redrawn at the new
    // device pixel ratio, or the prompt renders blurry/misaligned.
    const unregisterRefit = registerTerminalRefit(() => {
      commitResize()
      xterm.refresh(0, xterm.rows - 1)
    })

    return () => {
      offData()
      offExit()
      onInput.dispose()
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeObserver.disconnect()
      unregisterRefit()
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
