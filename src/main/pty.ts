import * as pty from 'node-pty'
import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { IPC, type PtyDataEvent, type PtyExitEvent, type PtySpawnOptions } from '../shared/ipc'
import { onPtyChunk, clearSession as clearWaitState } from './remote/waitDetector'

// Windows PowerShell 5.1 — pwsh.exe (PS7) is not installed on this machine.
// See docs/DISCOVERY.md §5.5. Spawned with no args so it loads the user's
// normal $PROFILE (Oh-My-Posh, PSReadLine, Terminal-Icons) unchanged, same
// as opening a standalone PowerShell window. Per-project configs may
// override the shell; this is just the fallback.
const DEFAULT_SHELL = 'powershell.exe'

// § ShinShell Remote — how much recent output a late-joining phone client
// gets replayed on subscribe. Generous enough for a multi-screen prompt,
// small enough that a chatty tab doesn't bloat memory per session.
const SCROLLBACK_CAP = 64 * 1024

interface Session {
  proc: pty.IPty
  windowId: number
  cwd: string
  tabKind?: 'terminal' | 'claude-code' | 'log-tail'
  label?: string
  scrollback: string
}

const sessions = new Map<string, Session>()

/** § ShinShell Remote — fan-out for main-process-internal consumers (the
 *  remote server) that need pty data/exit/state without going through the
 *  renderer IPC channel. `pty.ts` doesn't know or care whether anything is
 *  listening; Remote is purely additive. Events: 'data' (PtyDataEvent),
 *  'exit' (PtyExitEvent). */
export const ptyEvents = new EventEmitter()

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
  let proc: pty.IPty
  try {
    proc = pty.spawn(shell, shellArgs(shell, opts.oneShotCommand), {
      name: 'xterm-256color',
      cols: opts.cols,
      rows: opts.rows,
      cwd: opts.cwd,
      env: { ...process.env, ...opts.env } as Record<string, string>
    })
  } catch (err) {
    // § path validation — the renderer is expected to have already gated
    // this (no new terminal tabs while a project's workingDir is missing),
    // but restored tabs from a previous session bypass that gate, and a
    // race (folder renamed between the check and the click) always exists.
    // A bad cwd must never crash the main process — report it as an exit
    // instead so the (already-created) xterm shows "[process exited]"
    // rather than hanging with a dead pane forever.
    console.warn(`[pty] spawn failed for cwd "${opts.cwd}": ${err instanceof Error ? err.message : err}`)
    if (!win.isDestroyed()) {
      const payload: PtyExitEvent = { id: opts.id, exitCode: -1 }
      win.webContents.send(IPC.ptyExit, payload)
    }
    return
  }

  sessions.set(opts.id, {
    proc,
    windowId: win.id,
    cwd: opts.cwd,
    tabKind: opts.tabKind,
    label: opts.label,
    scrollback: ''
  })

  proc.onData((data) => {
    const payload: PtyDataEvent = { id: opts.id, data }
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyData, payload)

    // § ShinShell Remote — capped scrollback for late-joining clients, plus
    // a main-process-internal fan-out (independent of the renderer IPC
    // send above) so the remote server sees the same chunks without
    // touching the desktop app's own live-stream path.
    const session = sessions.get(opts.id)
    if (session) session.scrollback = (session.scrollback + data).slice(-SCROLLBACK_CAP)
    ptyEvents.emit('data', payload)
    if (session?.tabKind === 'claude-code') onPtyChunk(opts.id, data)
  })

  proc.onExit(({ exitCode }) => {
    sessions.delete(opts.id)
    clearWaitState(opts.id)
    const payload: PtyExitEvent = { id: opts.id, exitCode: exitCode ?? 0 }
    if (!win.isDestroyed()) win.webContents.send(IPC.ptyExit, payload)
    ptyEvents.emit('exit', payload)
  })
}

/** § ShinShell Remote — recent output for a session, replayed to a phone
 *  client the moment it subscribes so the terminal isn't blank until the
 *  next live chunk arrives. */
export function getScrollback(id: string): string {
  return sessions.get(id)?.scrollback ?? ''
}

/** § ShinShell Remote — which project window a session belongs to and
 *  whether it's a claude-code pane (gates remote input per §2 of the Remote
 *  server core: input is claude-code-only unless allowFullTerminalInput). */
export function getSessionMeta(
  id: string
): { windowId: number; cwd: string; tabKind?: 'terminal' | 'claude-code' | 'log-tail'; label?: string } | undefined {
  const session = sessions.get(id)
  return (
    session && { windowId: session.windowId, cwd: session.cwd, tabKind: session.tabKind, label: session.label }
  )
}

export function listSessionIds(): string[] {
  return [...sessions.keys()]
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
