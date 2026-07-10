import type { JSX } from 'preact'
import { useEffect, useRef } from 'preact/hooks'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { MultiplexClient } from '../ws/MultiplexClient'

interface TerminalViewProps {
  tabId: string
  allowInput: boolean
  client: MultiplexClient
  serverUrl: string
  token: string
}

const QUICK_KEYS: { label: string; key: string }[] = [
  { label: 'Enter', key: 'enter' },
  { label: 'Esc', key: 'esc' },
  { label: '↑', key: 'up' },
  { label: '↓', key: 'down' },
  { label: 'y', key: 'y' },
  { label: 'n', key: 'n' }
]

// § ShinShell Remote — read-optimized xterm.js view of one tab's stream,
// seeded from scrollback on subscribe then live, plus the "advance the
// session" surface: the fixed quick-action bar (POST /api/tabs/:id/keys)
// and a text input for typed replies (sent over the WS input frame,
// server-gated to claude-code tabs unless allowFullTerminalInput is on).
export default function TerminalView({
  tabId,
  allowInput,
  client,
  serverUrl,
  token
}: TerminalViewProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const xterm = new XTerm({
      fontSize: 13,
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

    const resizeObserver = new ResizeObserver(() => fitAddon.fit())
    resizeObserver.observe(container)

    const unsubscribe = client.subscribe(tabId, {
      onScrollback: ({ data }) => xterm.write(data),
      onData: ({ data }) => xterm.write(data),
      onExit: ({ exitCode }) => xterm.write(`\r\n[session ended, exit ${exitCode}]\r\n`)
    })

    return () => {
      unsubscribe()
      resizeObserver.disconnect()
      xterm.dispose()
    }
  }, [tabId, client])

  const sendKey = (key: string): void => {
    void fetch(`${serverUrl}/api/tabs/${tabId}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ key })
    })
  }

  const sendText = (e: Event): void => {
    e.preventDefault()
    const input = inputRef.current
    if (!input || !input.value) return
    client.sendInput(tabId, `${input.value}\r`)
    input.value = ''
  }

  return (
    <div class="terminal-view">
      <div class="terminal-view-canvas" ref={containerRef} />
      <div class="terminal-quick-actions">
        {QUICK_KEYS.map((k) => (
          <button key={k.key} onClick={() => sendKey(k.key)} disabled={!allowInput}>
            {k.label}
          </button>
        ))}
      </div>
      <form class="terminal-input-row" onSubmit={sendText}>
        <input
          ref={inputRef}
          type="text"
          placeholder={allowInput ? 'Type a reply…' : 'Read-only (plain terminal tab)'}
          disabled={!allowInput}
        />
        <button type="submit" disabled={!allowInput}>
          Send
        </button>
      </form>
    </div>
  )
}
