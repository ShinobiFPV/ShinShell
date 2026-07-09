import { Socket } from 'net'
import { BrowserWindow } from 'electron'
import { IPC, type SshHealthStatus } from '../shared/ipc'
import { getProject } from './projects'

const CHECK_INTERVAL_MS = 15_000
const CHECK_TIMEOUT_MS = 5_000

interface Subscription {
  win: BrowserWindow
  timer: ReturnType<typeof setInterval>
}

const subscriptions = new Map<string, Subscription>()

function checkTcp(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket()
    let done = false
    const finish = (ok: boolean): void => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(CHECK_TIMEOUT_MS)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(port, host)
  })
}

/** The target a project's SSH health light watches (§6.7): the one flagged
 *  healthCheck:true, or just the first target if none are flagged. */
function primaryTarget(projectId: string): { host: string; port: number } | null {
  const config = getProject(projectId)
  if (!config || config.targets.length === 0) return null
  const target = config.targets.find((t) => t.healthCheck) ?? config.targets[0]
  return { host: target.host, port: target.port }
}

async function runCheck(projectId: string): Promise<void> {
  const sub = subscriptions.get(projectId)
  if (!sub || sub.win.isDestroyed()) return
  const target = primaryTarget(projectId)
  if (!target) return

  sub.win.webContents.send(IPC.sshHealthStatus, {
    projectId,
    state: 'checking',
    lastCheckedAt: null
  } satisfies SshHealthStatus)

  const ok = await checkTcp(target.host, target.port)
  const current = subscriptions.get(projectId)
  if (!current || current.win.isDestroyed()) return
  current.win.webContents.send(IPC.sshHealthStatus, {
    projectId,
    state: ok ? 'up' : 'down',
    lastCheckedAt: Date.now()
  } satisfies SshHealthStatus)
}

export function subscribeSshHealth(win: BrowserWindow, projectId: string): void {
  if (subscriptions.has(projectId)) return
  const timer = setInterval(() => runCheck(projectId), CHECK_INTERVAL_MS)
  subscriptions.set(projectId, { win, timer })
  runCheck(projectId)
}

export function unsubscribeSshHealth(projectId: string): void {
  const sub = subscriptions.get(projectId)
  if (!sub) return
  clearInterval(sub.timer)
  subscriptions.delete(projectId)
}
