import type { Terminal as XTerm } from '@xterm/xterm'

// § Session view polish — Claude Code's interactive permission dialog is an
// ink-drawn box (border chars + a numbered, `❯`-marked option list) sized
// for a full-width desktop terminal. On a narrow phone viewport it wraps and
// redraws messily, reading as garbled/repeated text even though nothing is
// actually looping. Rather than trying to faithfully render that box, we
// read it back out of xterm's own parsed screen buffer (already resolved
// past cursor movement/redraws into a clean line grid) and hand the result
// to a plain HTML card instead.

export interface PromptOption {
  label: string
}

export interface ParsedPrompt {
  header: string
  options: PromptOption[]
  selectedIndex: number
}

// Generous enough for a full diff/file-edit approval box (tool name +
// command/patch + description), not just a one-line question -- see the
// header-scan below.
const SCAN_LINES = 100
const MAX_HEADER_LINES = 80
const FALLBACK_HEADER = 'Claude is asking:'

// Matches an ink SelectInput option line, border chars and cursor marker
// optional so reflow (border dropped/truncated) doesn't defeat detection --
// only the `❯` marker on exactly one line (below) is load-bearing.
const OPTION_RE = /^[│|]?\s*(❯)?\s*(\d+)\.\s*(.*?)\s*[│|]?$/

function stripBorder(line: string): string {
  return line.replace(/^[│|\s]+/, '').replace(/[│|\s]+$/, '')
}

/** Reads the tail of xterm's active buffer looking for a `❯`-marked option
 *  menu (Claude Code's permission/confirmation dialogs, plan-mode approval,
 *  etc.). Returns null for ordinary output, including prose numbered lists
 *  -- the `❯` cursor glyph is ink's SelectInput marker and never appears in
 *  Claude's own markdown, so it's the anchor that keeps this from firing on
 *  normal chat text. */
export function detectPermissionPrompt(term: XTerm): ParsedPrompt | null {
  const buffer = term.buffer.active
  const total = buffer.length
  const start = Math.max(0, total - SCAN_LINES)
  const lines: string[] = []
  for (let y = start; y < total; y++) {
    lines.push(buffer.getLine(y)?.translateToString(true) ?? '')
  }

  const collected: { marker: boolean; label: string }[] = []
  let topMatchedLineIdx = -1
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]
    if (line.trim() === '') {
      if (collected.length > 0) break
      continue
    }
    const match = OPTION_RE.exec(line)
    if (!match || !match[3]) {
      if (collected.length > 0) break
      continue
    }
    collected.push({ marker: match[1] === '❯', label: match[3].trim() })
    topMatchedLineIdx = i
  }

  if (collected.length < 2) return null
  collected.reverse() // was collected bottom-up; display (and dial) order is top-to-bottom
  const selectedIndex = collected.findIndex((o) => o.marker)
  if (selectedIndex === -1) return null

  // The full box body above the option list -- tool name, the actual
  // command/diff, and any description -- not just the one-line question
  // that happens to sit directly above the options. A prompt like Claude
  // Code's Bash/Edit approval is several paragraphs tall; grabbing only the
  // closest line above the options (the old behavior) silently dropped the
  // one thing a human needs to read before tapping Yes -- what they're
  // actually approving. Stops at the box's top border (╭/┌) so it doesn't
  // bleed into unrelated output above the dialog.
  const headerLines: string[] = []
  const lowerBound = Math.max(0, topMatchedLineIdx - MAX_HEADER_LINES)
  for (let i = topMatchedLineIdx - 1; i >= lowerBound; i--) {
    const raw = lines[i]
    if (/[╭┌]/.test(raw)) break
    headerLines.unshift(stripBorder(raw).trimEnd())
  }
  while (headerLines.length > 0 && headerLines[0] === '') headerLines.shift()
  while (headerLines.length > 0 && headerLines[headerLines.length - 1] === '') headerLines.pop()
  const header = headerLines.length > 0 ? headerLines.join('\n') : FALLBACK_HEADER

  return { header, options: collected.map((o) => ({ label: o.label })), selectedIndex }
}

/** Arrow-key + Enter sequence to move the ink SelectInput cursor from its
 *  current position to `targetIndex` and confirm -- sent raw over the
 *  existing input channel (client.sendInput), same path typed replies use. */
export function computeKeySequence(prompt: ParsedPrompt, targetIndex: number): string {
  const delta = targetIndex - prompt.selectedIndex
  const move = delta === 0 ? '' : delta > 0 ? '\x1b[B'.repeat(delta) : '\x1b[A'.repeat(-delta)
  return `${move}\r`
}

/** Cheap equality check so callers don't re-render on every identical
 *  repaint -- ink can redraw an unchanged box many times a second. */
export function promptsEqual(a: ParsedPrompt | null, b: ParsedPrompt | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.header !== b.header || a.selectedIndex !== b.selectedIndex) return false
  if (a.options.length !== b.options.length) return false
  return a.options.every((o, i) => o.label === b.options[i].label)
}
