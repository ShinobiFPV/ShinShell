import type { JSX } from 'preact'
import type { WaitStatus } from '../ws/protocol'

interface StatusBadgeProps {
  status?: WaitStatus
}

// § ShinShell Remote — the state dot on a session chip: green pulse =
// WAITING, spinner = BUSY, grey = IDLE. Plain terminal tabs (no state) get
// no dot at all.
export default function StatusBadge({ status }: StatusBadgeProps): JSX.Element | null {
  if (!status) return null
  return <span class={`status-dot status-dot-${status}`} title={status} />
}
