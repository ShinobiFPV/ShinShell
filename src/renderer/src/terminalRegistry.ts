// A tiny per-renderer registry of live terminal "refit" callbacks. Each
// mounted Terminal.tsx instance registers itself so a single broadcast (the
// window moving between differently-scaled monitors, per the responsive
// spec) can force every terminal to re-measure and redraw, not just the
// active one — xterm's canvas/WebGL renderer doesn't pick up a DPI change on
// its own since the container's CSS size didn't change, only its physical
// pixel density did.
const refitCallbacks = new Set<() => void>()

export function registerTerminalRefit(cb: () => void): () => void {
  refitCallbacks.add(cb)
  return () => refitCallbacks.delete(cb)
}

export function refitAllTerminals(): void {
  for (const cb of refitCallbacks) cb()
}
