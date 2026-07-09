import { useEffect, useState } from 'react'

export default function AdminBadge(): JSX.Element | null {
  const [elevated, setElevated] = useState<boolean | null>(null)

  useEffect(() => {
    window.shinshell.system.isElevated().then(setElevated)
  }, [])

  if (elevated === null) return null

  if (elevated) {
    return (
      <div className="admin-badge admin-badge-ok" title="Running elevated via the ShinShell scheduled task">
        ADMIN
      </div>
    )
  }

  return (
    <button
      className="admin-badge admin-badge-warn"
      title="Not running elevated — click to repair (relaunches elevated once)"
      onClick={() => window.shinshell.system.repair()}
    >
      NOT ELEVATED — REPAIR
    </button>
  )
}
