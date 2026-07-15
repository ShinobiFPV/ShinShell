import type { JSX } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { MultiplexClient } from '../ws/MultiplexClient'
import QuickActionButton from './QuickActionButton'
import PermissionPromptCard from './PermissionPromptCard'
import {
  clampFontSize,
  loadFontSize,
  loadSendHistory,
  pushSendHistory,
  saveFontSize,
  type CustomAction
} from '../localSettings'
import { apiUrl } from '../apiBase'
import { computeKeySequence, detectPermissionPrompt, promptsEqual, type ParsedPrompt } from '../permissionPrompt'

interface TerminalViewProps {
  tabId: string
  allowInput: boolean
  client: MultiplexClient
  serverUrl: string
  token: string
  customActions: CustomAction[]
}

const SCROLLBACK_LINES = 5000

const QUICK_KEYS: { label: string; key: string; preview: string }[] = [
  { label: 'Enter', key: 'enter', preview: 'Sends: Enter' },
  { label: 'Esc', key: 'esc', preview: 'Sends: Escape' },
  { label: 'y', key: 'y', preview: 'Sends: "y"' },
  { label: 'n', key: 'n', preview: 'Sends: "n"' }
]

const ARROW_KEYS: { label: string; key: string; preview: string }[] = [
  { label: '↑', key: 'up', preview: 'Sends: Up arrow' },
  { label: '↓', key: 'down', preview: 'Sends: Down arrow' },
  { label: '←', key: 'left', preview: 'Sends: Left arrow' },
  { label: '→', key: 'right', preview: 'Sends: Right arrow' }
]

// Matches the monospace stack used elsewhere in the app (theme.css), plus
// the self-hosted Braille-only subset font (see its @font-face in theme.css)
// so Claude Code's spinner — which uses Braille Pattern glyphs, a block
// xterm's customGlyphs renderer doesn't cover and iOS/Android don't ship a
// system font for — always resolves to the same bundled glyphs instead of
// whatever a given phone happens to fall back to.
const TERMINAL_FONT_FAMILY =
  '"JuliaMono Braille Subset", ui-monospace, SFMono-Regular, Menlo, Consolas, "DejaVu Sans Mono", monospace'

function touchDistance(touches: TouchList): number {
  const [a, b] = [touches[0], touches[1]]
  return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
}

// § Session view polish (§2) — read-optimized xterm.js view of one tab's
// stream (scrollback replay then live), plus every way to "advance the
// session": the quick-action bar (fixed defaults + user-editable snippets,
// long-press previews what they send), and a text field with send-history
// and a multiline toggle for longer replies.
export default function TerminalView({
  tabId,
  allowInput,
  client,
  serverUrl,
  token,
  customActions
}: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const xtermRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  const [fontSize, setFontSize] = useState(loadFontSize)
  const [atBottom, setAtBottom] = useState(true)
  const [multiline, setMultiline] = useState(false)
  const [draft, setDraft] = useState('')
  const [history, setHistory] = useState<string[]>(loadSendHistory)
  const [historyPos, setHistoryPos] = useState<number | null>(null)
  const [prompt, setPrompt] = useState<ParsedPrompt | null>(null)
  const promptRef = useRef<ParsedPrompt | null>(null)
  // § size-mismatch fix -- the pty's *real* cols/rows, reported by the
  // server (see MultiplexClient's onResize). Both dimensions matter, not
  // just cols: ink redraws its live region (permission prompts, spinners)
  // by moving the cursor up N rows and overwriting, entirely independent of
  // terminal width -- but that cursor-up is clamped at row 0 of the
  // *current screen*, whose height is xterm.js's own `rows`. If the phone's
  // xterm has fewer rows than ink's redraw region needs (very likely if
  // rows is fit to the phone's small container instead of the real pty),
  // the clamp makes each redraw overwrite the wrong lines in place -- which
  // reads as exactly what it is: readable text, scrambled vertically.
  const realSizeRef = useRef<{ cols: number; rows: number } | null>(null)

  // Fit to the container as usual until the real size is known, then lock
  // both cols and rows to it -- see realSizeRef above. Used on mount, on
  // container resize, and on font-size change (pinch/A-/A+), replacing bare
  // `fitAddon.fit()` calls everywhere. Once locked, the rendered terminal
  // block may be taller than the visible container -- see the
  // overflow-y/touch-action rule on .terminal-view-canvas in theme.css,
  // which makes that reachable by scroll instead of letting it clip or spill
  // into the UI below.
  const refit = useCallback(() => {
    const xterm = xtermRef.current
    const fitAddon = fitAddonRef.current
    if (!xterm || !fitAddon) return
    const real = realSizeRef.current
    if (real) {
      if (xterm.cols !== real.cols || xterm.rows !== real.rows) {
        xterm.resize(real.cols, real.rows)
      }
      return
    }
    const proposed = fitAddon.proposeDimensions()
    if (proposed && (xterm.cols !== proposed.cols || xterm.rows !== proposed.rows)) {
      xterm.resize(proposed.cols, proposed.rows)
    }
  }, [])

  const applyFontSize = useCallback(
    (size: number) => {
      const clamped = clampFontSize(size)
      setFontSize(clamped)
      saveFontSize(clamped)
      const xterm = xtermRef.current
      if (xterm) {
        xterm.options.fontSize = clamped
        refit()
      }
    },
    [refit]
  )

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // A tab switch remounts the terminal for a different session entirely --
    // any permission prompt detected against the previous one is stale, and
    // so is any previously-known real pty size.
    promptRef.current = null
    setPrompt(null)
    realSizeRef.current = null

    const xterm = new XTerm({
      fontSize,
      fontFamily: TERMINAL_FONT_FAMILY,
      scrollback: SCROLLBACK_LINES,
      cursorBlink: false,
      convertEol: true,
      // Read-optimized (§ PWA): typed replies go through the quick-action
      // bar / text input below, not direct keystrokes into the terminal
      // widget itself.
      disableStdin: true,
      theme: { background: '#0b0d10' }
    })
    const fitAddon = new FitAddon()
    xterm.loadAddon(fitAddon)
    xterm.open(container)
    fitAddon.fit()
    xtermRef.current = xterm
    fitAddonRef.current = fitAddon

    const updateAtBottom = (): void => {
      const buf = xterm.buffer.active
      setAtBottom(buf.viewportY >= buf.baseY)
    }
    xterm.onScroll(updateAtBottom)

    // Re-parse the tail of the buffer for a permission-style prompt after
    // every chunk (see permissionPrompt.ts) -- independent of the server's
    // busy/waiting/idle classification, which waits out a quiet period
    // before flipping and would add a needless delay before the card shows.
    const refreshPrompt = (): void => {
      const next = detectPermissionPrompt(xterm)
      if (!promptsEqual(promptRef.current, next)) {
        promptRef.current = next
        setPrompt(next)
      }
    }
    const onWrite = (): void => {
      updateAtBottom()
      refreshPrompt()
    }

    const resizeObserver = new ResizeObserver(() => refit())
    resizeObserver.observe(container)

    const unsubscribe = client.subscribe(tabId, {
      onScrollback: ({ data }) => xterm.write(data, onWrite),
      onData: ({ data }) => xterm.write(data, onWrite),
      onResize: ({ cols, rows }) => {
        realSizeRef.current = { cols, rows }
        refit()
      },
      onExit: ({ exitCode }) => {
        promptRef.current = null
        setPrompt(null)
        xterm.write(`\r\n[session ended, exit ${exitCode}]\r\n`, updateAtBottom)
      }
    })

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      xterm.dispose()
      xtermRef.current = null
      fitAddonRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fontSize is only the *initial* value; later changes go through applyFontSize
  }, [tabId, client])

  // Two-finger pinch → font size. `touch-action: none` on the canvas (see
  // theme.css) stops the browser's own page-zoom from fighting this.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    let startDist: number | null = null
    let startSize = fontSize

    const onTouchStart = (e: TouchEvent): void => {
      if (e.touches.length !== 2) return
      startDist = touchDistance(e.touches)
      startSize = xtermRef.current?.options.fontSize ?? fontSize
    }
    const onTouchMove = (e: TouchEvent): void => {
      if (e.touches.length !== 2 || startDist === null) return
      e.preventDefault()
      const scale = touchDistance(e.touches) / startDist
      applyFontSize(startSize * scale)
    }
    const onTouchEnd = (e: TouchEvent): void => {
      if (e.touches.length < 2) startDist = null
    }

    container.addEventListener('touchstart', onTouchStart, { passive: true })
    container.addEventListener('touchmove', onTouchMove, { passive: false })
    container.addEventListener('touchend', onTouchEnd)
    container.addEventListener('touchcancel', onTouchEnd)
    return () => {
      container.removeEventListener('touchstart', onTouchStart)
      container.removeEventListener('touchmove', onTouchMove)
      container.removeEventListener('touchend', onTouchEnd)
      container.removeEventListener('touchcancel', onTouchEnd)
    }
  }, [applyFontSize, fontSize])

  const sendKey = (key: string): void => {
    void fetch(apiUrl(serverUrl, `/tabs/${tabId}/keys`), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ key })
    })
  }

  const sendCustomAction = (value: string): void => {
    client.sendInput(tabId, `${value}\r`)
  }

  const selectPromptOption = (index: number): void => {
    if (!prompt) return
    client.sendInput(tabId, computeKeySequence(prompt, index))
    // Optimistic hide -- avoids a stale, still-tappable card during the
    // round trip; the next chunk naturally restores or re-detects as needed.
    promptRef.current = null
    setPrompt(null)
  }

  const submitDraft = useCallback(() => {
    if (!draft.trim()) return
    client.sendInput(tabId, `${draft}\r`)
    setHistory(pushSendHistory(draft))
    setHistoryPos(null)
    setDraft('')
  }, [client, tabId, draft])

  const onInputKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      if (history.length === 0) return
      const next = historyPos === null ? 0 : Math.min(historyPos + 1, history.length - 1)
      setHistoryPos(next)
      setDraft(history[next])
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (historyPos === null) return
      const next = historyPos - 1
      if (next < 0) {
        setHistoryPos(null)
        setDraft('')
      } else {
        setHistoryPos(next)
        setDraft(history[next])
      }
    }
  }

  const onTextareaKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLTextAreaElement>): void => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      submitDraft()
    }
  }

  return (
    <div class="terminal-view">
      <div class="terminal-canvas-wrap">
        <div class="terminal-view-canvas" ref={containerRef} />
        <div class="terminal-toolbar">
          <button class="font-size-btn" onClick={() => applyFontSize(fontSize - 1)} title="Smaller text">
            A-
          </button>
          <span class="font-size-value">{fontSize}</span>
          <button class="font-size-btn" onClick={() => applyFontSize(fontSize + 1)} title="Larger text">
            A+
          </button>
        </div>
        {!atBottom && (
          <button class="jump-to-live-pill" onClick={() => xtermRef.current?.scrollToBottom()}>
            ↓ Jump to live
          </button>
        )}
        {prompt && <PermissionPromptCard prompt={prompt} onSelect={selectPromptOption} />}
      </div>

      {allowInput ? (
        <>
          <div class="terminal-quick-actions">
            {QUICK_KEYS.map((k) => (
              <QuickActionButton key={k.key} label={k.label} preview={k.preview} onPress={() => sendKey(k.key)} />
            ))}
            {customActions.map((a) => (
              <QuickActionButton
                key={a.id}
                label={a.label}
                preview={`Sends: "${a.value}" + Enter`}
                onPress={() => sendCustomAction(a.value)}
              />
            ))}
          </div>

          <div class="terminal-quick-actions terminal-arrow-row">
            {ARROW_KEYS.map((k) => (
              <QuickActionButton key={k.key} label={k.label} preview={k.preview} onPress={() => sendKey(k.key)} />
            ))}
          </div>

          <form
            class="terminal-input-row"
            onSubmit={(e) => {
              e.preventDefault()
              submitDraft()
            }}
          >
            {multiline ? (
              <textarea
                value={draft}
                onInput={(e) => setDraft((e.target as HTMLTextAreaElement).value)}
                onKeyDown={onTextareaKeyDown}
                placeholder="Type a reply… (Ctrl+Enter to send)"
                rows={3}
              />
            ) : (
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onInput={(e) => {
                  setDraft((e.target as HTMLInputElement).value)
                  setHistoryPos(null)
                }}
                onKeyDown={onInputKeyDown}
                placeholder="Type a reply…"
              />
            )}
            <button
              type="button"
              class="terminal-multiline-toggle"
              onClick={() => setMultiline((m) => !m)}
              title={multiline ? 'Switch to single line' : 'Switch to multiline'}
            >
              {multiline ? '1L' : '¶'}
            </button>
            <button type="submit" disabled={!draft.trim()}>
              Send
            </button>
          </form>
        </>
      ) : (
        // § read-only visibility (§4) — the input bar doesn't just disable
        // here, it's gone entirely: a log-tail (or any non-claude-code) tab
        // has nothing to type into unless allowFullTerminalInput is on, in
        // which case allowInput is already true and this branch never renders.
        <div class="terminal-view-only-bar">VIEW ONLY</div>
      )}
    </div>
  )
}
