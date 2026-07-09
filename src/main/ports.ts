import { execFile } from 'child_process'
import { promisify } from 'util'
import type { PortEntry } from '../shared/ipc'

const execFileAsync = promisify(execFile)

const LIST_SCRIPT = `
$tcp = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    Port = $_.LocalPort
    Pid = $_.OwningProcess
    ProcessName = if ($proc) { $proc.ProcessName } else { "unknown" }
    Protocol = "TCP"
  }
}
$udp = Get-NetUDPEndpoint -ErrorAction SilentlyContinue | ForEach-Object {
  $proc = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue
  [PSCustomObject]@{
    Port = $_.LocalPort
    Pid = $_.OwningProcess
    ProcessName = if ($proc) { $proc.ProcessName } else { "unknown" }
    Protocol = "UDP"
  }
}
@($tcp) + @($udp) | ConvertTo-Json -Compress
`.trim()

export async function listListeningPorts(): Promise<PortEntry[]> {
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', LIST_SCRIPT],
    { maxBuffer: 10 * 1024 * 1024 }
  )
  const trimmed = stdout.trim()
  if (!trimmed) return []
  const parsed = JSON.parse(trimmed)
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const seen = new Set<string>()
  const entries: PortEntry[] = []
  for (const row of rows) {
    if (!row || typeof row.Port !== 'number') continue
    const key = `${row.Protocol}:${row.Port}:${row.Pid}`
    if (seen.has(key)) continue
    seen.add(key)
    entries.push({
      port: row.Port,
      pid: row.Pid,
      processName: row.ProcessName || 'unknown',
      protocol: row.Protocol === 'UDP' ? 'UDP' : 'TCP'
    })
  }
  return entries.sort((a, b) => a.port - b.port)
}

export async function killProcess(pid: number): Promise<void> {
  await execFileAsync('taskkill.exe', ['/PID', String(pid), '/F'])
}
