import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { IPC, type PtyDataEvent, type PtyExitEvent, type PtySpawnOptions } from '../shared/ipc'

// Windows PowerShell 5.1 — pwsh.exe (PS7) is not installed on this machine.
// See docs/DISCOVERY.md §5.5. Spawned with no args so it loads the user's
// normal $PROFILE (Oh-My-Posh, PSReadLine, Terminal-Icons) unchanged, same
// as opening a standalone PowerShell window. Per-project configs may
// override the shell; this is just the fallback.
const DEFAULT_SHELL = 'powershell.exe'

interface Session {
  proc: pty.IPty
  windowId: number
}

const sessions = new Map<string, Session>()

function shellArgs(shell: string, oneShotCommand?: string): string[] {
  if (!oneShotCommand) return [] // interactive shell — normal terminal tabs
  // PowerShell (5.1 or 7) is the only shell in practice on this machine
  // today (see docs/DISCOVERY.md §5.5); bash-style shells get -c as a
  // reasonable fallback if that ever changes.
  const isPowerShell = /powershell|pwsh/i.test(shell)
  return isPowerShell ? ['-NoProfile', '-Command', oneShotCommand] : ['-c', oneShotCommand]
}

export function spawnPty(win: BrowserWindow, opts: PtySpawnOptions): void {
  const shell = opts.shell || DEFAULT_SHELL
  const proc = pty.spawn(shell, shellArgs(shell, opts.oneShotCommand), {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as Record<string, string>
  })

  sessions.set(opts.id, { proc, windowId: win.id })

  proc.onData((data) => {
    if (win.isDestroyed()) return
    const payload: PtyDataEvent = { id: opts.id, data }
    win.webContents.send(IPC.ptyData, payload)
  })

  proc.onExit(({ exitCode }) => {
    sessions.delete(opts.id)
    if (win.isDestroyed()) return
    const payload: PtyExitEvent = { id: opts.id, exitCode: exitCode ?? 0 }
    win.webContents.send(IPC.ptyExit, payload)
  })
}

export function writePty(id: string, data: string): void {
  sessions.get(id)?.proc.write(data)
}

export function resizePty(id: string, cols: number, rows: number): void {
  sessions.get(id)?.proc.resize(cols, rows)
}

export function killPty(id: string): void {
  sessions.get(id)?.proc.kill()
  sessions.delete(id)
}

export function killPtysForWindow(windowId: number): void {
  for (const [id, session] of sessions) {
    if (session.windowId === windowId) {
      session.proc.kill()
      sessions.delete(id)
    }
  }
}

export function killAllPty(): void {
  for (const session of sessions.values()) session.proc.kill()
  sessions.clear()
}
