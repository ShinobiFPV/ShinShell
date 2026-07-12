import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'

interface ConnectionRibbonProps {
  connected: boolean
  /** epoch ms the WS last dropped, or null if it's never been down (or is
   *  currently up). Set once on the first disconnect and held steady across
   *  repeated reconnect attempts — see app.tsx's onConnectionChange wiring. */
  disconnectedSince: number | null
}

// § connection UX (§6) — a brief "still trying" state reads as reassuring;
// the same message for two straight minutes reads as broken. This ribbon
// distinguishes the two purely by elapsed time: under the threshold it's
// "Reconnecting…", past it the ribbon names the actual moment things went
// down so a glance answers "how long has this been broken" without math.
const OFFLINE_THRESHOLD_MS = 15_000

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export default function ConnectionRibbon({ connected, disconnectedSince }: ConnectionRibbonProps): JSX.Element | null {
  const [, tick] = useState(0)

  useEffect(() => {
    if (connected || disconnectedSince === null) return
    const timer = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(timer)
  }, [connected, disconnectedSince])

  if (connected || disconnectedSince === null) return null

  const downMs = Date.now() - disconnectedSince
  if (downMs < OFFLINE_THRESHOLD_MS) {
    return <div class="connection-ribbon connection-ribbon-reconnecting">Reconnecting to ShinShell…</div>
  }
  return (
    <div class="connection-ribbon connection-ribbon-offline">
      ShinShell offline since {formatClock(disconnectedSince)}
    </div>
  )
}
