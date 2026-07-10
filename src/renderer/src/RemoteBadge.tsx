import { useEffect, useState } from 'react'
import type { RemoteStatus } from '../../shared/ipc'

interface RemoteBadgeProps {
  onClick: () => void
}

// § ShinShell Remote — AdminBadge's sibling: a small persistent status
// affordance, off/error/connected tri-state, living in the launcher header
// only (not ProjectWindow's closed-contract tab-strip-row).
export default function RemoteBadge({ onClick }: RemoteBadgeProps): JSX.Element | null {
  const [status, setStatus] = useState<RemoteStatus | null>(null)

  useEffect(() => {
    window.shinshell.remote.getStatus().then(setStatus)
    return window.shinshell.remote.onStatus(setStatus)
  }, [])

  if (!status) return null

  if (!status.enabled) {
    return (
      <button className="remote-badge remote-badge-off" onClick={onClick} title="ShinShell Remote is off">
        REMOTE OFF
      </button>
    )
  }

  if (!status.running) {
    return (
      <button
        className="remote-badge remote-badge-warn"
        onClick={onClick}
        title={status.error ?? 'Remote failed to start'}
      >
        REMOTE ERROR
      </button>
    )
  }

  return (
    <button className="remote-badge remote-badge-ok" onClick={onClick} title={status.url ?? undefined}>
      REMOTE · {status.pairedDeviceCount} {status.pairedDeviceCount === 1 ? 'device' : 'devices'}
    </button>
  )
}
