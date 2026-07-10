// § ShinShell Remote — classifies each claude-code pty session as
// busy / waiting / idle from raw output alone, so the phone client and push
// notifications know when a session actually needs a human. See the plan's
// "Waiting-for-input detection" section for the algorithm rationale.
import { EventEmitter } from 'events'
import { stripAnsi } from './ansi'

export type WaitStatus = 'busy' | 'waiting' | 'idle'

const QUIET_MS = 2000
// Generous enough to hold a multi-line prompt block; small enough that a
// chatty tab's tail buffer never noticeably adds up.
const TAIL_CAP = 8192

// Matched against the last non-blank line of the (ANSI-stripped) tail once
// output has gone quiet — see classifyQuiet below.
const PROMPT_PATTERNS: RegExp[] = [
  /[?？]\s*$/, // trailing "? "
  /\by\/n\b\s*$/i, // "y/n"
  /❯\s*$/, // inquirer/clack-style option-list marker
  /press\s+(enter|any key)/i,
  /\(esc\)\s*$/i
]

interface SessionState {
  status: WaitStatus
  tail: string
  bellSeen: boolean
  quietTimer: ReturnType<typeof setTimeout> | null
}

const states = new Map<string, SessionState>()

/** Emits 'state' ({ id, status }) on every busy/waiting/idle transition —
 *  never on a re-check that doesn't change the classification, which is
 *  what keeps this from spamming the WS/push layers above it. */
export const waitEvents = new EventEmitter()

function setStatus(id: string, st: SessionState, next: WaitStatus): void {
  if (st.status === next) return
  st.status = next
  waitEvents.emit('state', { id, status: next })
}

/** Feed a raw pty output chunk in. Called from pty.ts's onData handler for
 *  every claude-code session (plain terminals aren't classified — nothing
 *  reads their state). */
export function onPtyChunk(id: string, chunk: string): void {
  let st = states.get(id)
  if (!st) {
    st = { status: 'busy', tail: '', bellSeen: false, quietTimer: null }
    states.set(id, st)
  }
  st.tail = (st.tail + chunk).slice(-TAIL_CAP)
  if (chunk.includes('\u0007')) st.bellSeen = true

  // Any new data means the session is doing something — this is also what
  // prevents a fast-moving spinner/progress-bar from ever reaching
  // classifyQuiet: it never goes 2s without a chunk, so it never gets
  // re-evaluated against the prompt patterns at all.
  setStatus(id, st, 'busy')

  if (st.quietTimer) clearTimeout(st.quietTimer)
  st.quietTimer = setTimeout(() => classifyQuiet(id), QUIET_MS)
}

function classifyQuiet(id: string): void {
  const st = states.get(id)
  if (!st) return
  const lines = stripAnsi(st.tail)
    .split(/\r?\n/)
    .map((l) => l.trimEnd())
    .filter(Boolean)
  const lastLine = lines[lines.length - 1] ?? ''
  const isPrompt = st.bellSeen || PROMPT_PATTERNS.some((re) => re.test(lastLine))
  setStatus(id, st, isPrompt ? 'waiting' : 'idle')
  st.bellSeen = false
}

export function getStatus(id: string): WaitStatus {
  return states.get(id)?.status ?? 'idle'
}

/** Called on pty exit (see pty.ts's ptyEvents 'exit') so a closed session's
 *  timer doesn't fire into a Map entry nobody will ever read again. */
export function clearSession(id: string): void {
  const st = states.get(id)
  if (st?.quietTimer) clearTimeout(st.quietTimer)
  states.delete(id)
}
