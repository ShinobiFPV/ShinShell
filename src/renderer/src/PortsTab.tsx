import { useCallback, useEffect, useState } from 'react'
import type { PortEntry } from '../../shared/ipc'

interface PortsTabProps {
  projectPorts: number[]
}

const REFRESH_INTERVAL_MS = 10_000

export default function PortsTab({ projectPorts }: PortsTabProps): JSX.Element {
  const [ports, setPorts] = useState<PortEntry[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setPorts(await window.shinshell.ports.list())
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, REFRESH_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const kill = useCallback(
    async (entry: PortEntry) => {
      if (!window.confirm(`Kill ${entry.processName} (PID ${entry.pid}) listening on ${entry.port}?`)) return
      window.shinshell.ports.kill(entry.pid)
      // Optimistic remove — refresh() below will correct it either way.
      setPorts((prev) => prev.filter((p) => p !== entry))
      setTimeout(refresh, 500)
    },
    [refresh]
  )

  const projectPortSet = new Set(projectPorts)
  const filterLower = filter.trim().toLowerCase()
  const filtered = ports.filter(
    (p) =>
      !filterLower ||
      String(p.port).includes(filterLower) ||
      p.processName.toLowerCase().includes(filterLower) ||
      String(p.pid).includes(filterLower)
  )

  return (
    <div className="ports-tab">
      <div className="ports-toolbar">
        <input
          className="ports-filter"
          placeholder="Filter by port, process, or PID…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <button onClick={refresh}>Refresh</button>
        {loading && <span className="ports-loading">Loading…</span>}
      </div>
      <div className="ports-table">
        <div className="ports-row ports-header">
          <span>Port</span>
          <span>Protocol</span>
          <span>Process</span>
          <span>PID</span>
          <span></span>
        </div>
        {filtered.map((entry) => (
          <div
            key={`${entry.protocol}-${entry.port}-${entry.pid}`}
            className={`ports-row${projectPortSet.has(entry.port) ? ' ports-row-highlight' : ''}`}
          >
            <span>{entry.port}</span>
            <span>{entry.protocol}</span>
            <span>{entry.processName}</span>
            <span>{entry.pid}</span>
            <button className="ports-kill" onClick={() => kill(entry)}>
              Kill
            </button>
          </div>
        ))}
        {!loading && filtered.length === 0 && <div className="ports-empty">No matching ports.</div>}
      </div>
    </div>
  )
}
