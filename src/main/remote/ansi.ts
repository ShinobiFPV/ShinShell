// § ShinShell Remote -- strips ANSI escape sequences so the waiting-for-input
// heuristic (waitDetector.ts) can pattern-match plain text instead of
// ConPTY's raw CSI/OSC-laden output. Deliberately hand-rolled (not a new
// dependency) -- this is the same handful of sequence shapes strip-ansi
// covers, and it's a dozen lines.
//
// Covers: CSI sequences (colors, cursor movement -- backslash-u001B [ params
// intermediates final), OSC sequences (title-set etc. -- backslash-u001B ]
// ... backslash-u0007, or backslash-u001B ] ... backslash-u001B backslash),
// and other two-character escapes. A bare BEL (backslash-u0007) that isn't
// part of an OSC sequence is deliberately left untouched -- it's a
// standalone prompt signal the classifier checks for directly.
const ESC_CHAR_CLASS = "\\u001B\\u009B"
const BEL_CHAR = "\\u0007"
// eslint-disable-next-line no-control-regex
const ANSI_RE = new RegExp(
  "[" + ESC_CHAR_CLASS + "](?:" +
    "\\[[0-9;?]*[ -/]*[@-~]" + "|" +
    "\\][^" + BEL_CHAR + "\\u001B]*(?:" + BEL_CHAR + "|\\u001B\\\\)" + "|" +
    "[@-Z\\\\-_]" +
  ")",
  "g"
)

export function stripAnsi(input: string): string {
  return input.replace(ANSI_RE, "")
}
