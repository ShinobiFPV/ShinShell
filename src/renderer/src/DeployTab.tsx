import { useCallback, useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ProjectConfig } from '../../shared/project'
import type { DeployRun } from '../../shared/ipc'
import { substituteVariables } from '../../shared/commandSubstitution'

interface DeployTabProps {
  projectId: string
  config: ProjectConfig
  active: boolean
}

let runCounter = 0

function formatWhen(ts: number): string {
  const diffMs = Date.now() - ts
  const mins = Math.round(diffMs / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(ts).toLocaleString()
}

export default function DeployTab({ projectId, config, active }: DeployTabProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const [running, setRunning] = useState(false)
  const [history, setHistory] = useState<DeployRun[]>([])

  const deployCommands = config.commands.filter((c) => c.id.startsWith('deploy'))

  useEffect(() => {
    window.shinshell.deployHistory.get(projectId).then(setHistory)
  }, [projectId])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const xterm = new XTerm({
      fontFamily: '"Cascadia Code NF", "Cascadia Mono NF", Consolas, monospace',
      fontSize: 12,
      cursorBlink: false,
      convertEol: true,
      theme: { background: '#0c0c0c' }
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(container)
    xtermRef.current = xterm
    fitRef.current = fitAddon
    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)
    fitAddon.fit()
    return () => {
      resizeObserver.disconnect()
      xterm.dispose()
    }
  }, [])

  useEffect(() => {
    if (active) fitRef.current?.fit()
  }, [active])

  const run = useCallback(
    (commandId: string, label: string, commandStr: string) => {
      if (running) return
      const xterm = xtermRef.current
      if (!xterm) return
      setRunning(true)
      xterm.reset()
      xterm.writeln(`$ ${commandStr}\r\n`)

      const substituted = substituteVariables(commandStr, config)
      const id = `deploy-${projectId}-${Date.now()}-${runCounter++}`
      const startedAt = Date.now()

      const offData = window.shinshell.pty.onData((e) => {
        if (e.id === id) xterm.write(e.data)
      })
      const offExit = window.shinshell.pty.onExit((e) => {
        if (e.id !== id) return
        offData()
        offExit()
        setRunning(false)
        const run: DeployRun = {
          commandId,
          commandLabel: label,
          startedAt,
          durationMs: Date.now() - startedAt,
          exitCode: e.exitCode
        }
        window.shinshell.deployHistory.append(projectId, run)
        setHistory((prev) => [run, ...prev].slice(0, 20))
        xterm.writeln(`\r\n[exit ${e.exitCode}, ${(run.durationMs / 1000).toFixed(1)}s]`)
      })

      window.shinshell.pty.spawn({
        id,
        cwd: config.workingDir,
        cols: xterm.cols,
        rows: xterm.rows,
        shell: config.shell,
        env: config.env,
        oneShotCommand: substituted
      })
    },
    [running, config, projectId]
  )

  return (
    <div className="deploy-tab">
      <div className="deploy-toolbar">
        {deployCommands.length === 0 ? (
          <span className="deploy-empty">No deploy commands configured for this project.</span>
        ) : (
          deployCommands.map((c) => (
            <button key={c.id} disabled={running} onClick={() => run(c.id, c.label, c.command)}>
              {c.label}
            </button>
          ))
        )}
      </div>
      <div ref={containerRef} className="deploy-output" />
      <div className="deploy-history">
        <div className="deploy-history-header">Recent runs</div>
        {history.length === 0 ? (
          <div className="deploy-empty">No runs yet.</div>
        ) : (
          history.map((r, i) => (
            <div key={i} className="deploy-history-row">
              <span className={`deploy-status ${r.exitCode === 0 ? 'ok' : 'fail'}`}>
                {r.exitCode === 0 ? '✓' : '✗'}
              </span>
              <span className="deploy-history-label">{r.commandLabel}</span>
              <span className="deploy-history-when">{formatWhen(r.startedAt)}</span>
              <span className="deploy-history-duration">{(r.durationMs / 1000).toFixed(1)}s</span>
              <span className="deploy-history-exit">exit {r.exitCode}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
