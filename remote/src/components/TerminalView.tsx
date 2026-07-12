import type { JSX } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { MultiplexClient } from '../ws/MultiplexClient'
import QuickActionButton from './QuickActionButton'
import {
  clampFontSize,
  loadFontSize,
  loadSendHistory,
  pushSendHistory,
  saveFontSize,
  type CustomAction
} from '../localSettings'

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
  { label: '↑', key: 'up', preview: 'Sends: Up arrow' },
  { label: '↓', key: 'down', preview: 'Sends: Down arrow' },
  { label: 'y', key: 'y', preview: 'Sends: "y"' },
  { label: 'n', key: 'n', preview: 'Sends: "n"' }
]

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

  const applyFontSize = useCallback((size: number) => {
    const clamped = clampFontSize(size)
    setFontSize(clamped)
    saveFontSize(clamped)
    const xterm = xtermRef.current
    if (xterm) {
      xterm.options.fontSize = clamped
      fitAddonRef.current?.fit()
    }
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const xterm = new XTerm({
      fontSize,
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

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)

    const unsubscribe = client.subscribe(tabId, {
      onScrollback: ({ data }) => xterm.write(data, updateAtBottom),
      onData: ({ data }) => xterm.write(data, updateAtBottom),
      onExit: ({ exitCode }) => xterm.write(`\r\n[session ended, exit ${exitCode}]\r\n`, updateAtBottom)
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
    void fetch(`${serverUrl}/api/tabs/${tabId}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ key })
    })
  }

  const sendCustomAction = (value: string): void => {
    client.sendInput(tabId, `${value}\r`)
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
      </div>

      <div class="terminal-quick-actions">
        {QUICK_KEYS.map((k) => (
          <QuickActionButton
            key={k.key}
            label={k.label}
            preview={k.preview}
            disabled={!allowInput}
            onPress={() => sendKey(k.key)}
          />
        ))}
      </div>

      {customActions.length > 0 && (
        <div class="terminal-quick-actions terminal-quick-actions-custom">
          {customActions.map((a) => (
            <QuickActionButton
              key={a.id}
              label={a.label}
              preview={`Sends: "${a.value}" + Enter`}
              disabled={!allowInput}
              onPress={() => sendCustomAction(a.value)}
            />
          ))}
        </div>
      )}

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
            placeholder={allowInput ? 'Type a reply… (Ctrl+Enter to send)' : 'Read-only (plain terminal tab)'}
            disabled={!allowInput}
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
            placeholder={allowInput ? 'Type a reply…' : 'Read-only (plain terminal tab)'}
            disabled={!allowInput}
          />
        )}
        <button
          type="button"
          class="terminal-multiline-toggle"
          onClick={() => setMultiline((m) => !m)}
          disabled={!allowInput}
          title={multiline ? 'Switch to single line' : 'Switch to multiline'}
        >
          {multiline ? '1L' : '¶'}
        </button>
        <button type="submit" disabled={!allowInput || !draft.trim()}>
          Send
        </button>
      </form>
    </div>
  )
}
