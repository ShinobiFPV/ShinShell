import * as pty from 'node-pty'
import { BrowserWindow } from 'electron'
import { IPC, type PtyDataEvent, type PtyExitEvent, type PtySpawnOptions } from '../shared/ipc'

// Windows PowerShell 5.1 — pwsh.exe (PS7) is not installed on this machine.
// See docs/DISCOVERY.md §5.5. Spawned with no args so it loads the user's
// normal $PROFILE (Oh-My-Posh, PSReadLine, Terminal-Icons) unchanged, same
// as opening a standalone PowerShell window.
const DEFAULT_SHELL = 'powershell.exe'

const sessions = new Map<string, pty.IPty>()

export function spawnPty(win: BrowserWindow, opts: PtySpawnOptions): void {
  const proc = pty.spawn(DEFAULT_SHELL, [], {
    name: 'xterm-256color',
    cols: opts.cols,
    rows: opts.rows,
    cwd: opts.cwd,
    env: process.env as Record<string, string>
  })

  sessions.set(opts.id, proc)

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
  sessions.get(id)?.write(data)
}

export function resizePty(id: string, cols: number, rows: number): void {
  sessions.get(id)?.resize(cols, rows)
}

export function killPty(id: string): void {
  sessions.get(id)?.kill()
  sessions.delete(id)
}

export function killAllPty(): void {
  for (const proc of sessions.values()) proc.kill()
  sessions.clear()
}
