import { useEffect, useState } from 'react'
import type { SshHealthState } from '../../shared/ipc'

interface SshHealthLightProps {
  projectId: string
  hasTarget: boolean
}

// §6.7 — status light polling the project's primary SSH target every ~15s.
export default function SshHealthLight({ projectId, hasTarget }: SshHealthLightProps): JSX.Element | null {
  const [state, setState] = useState<SshHealthState>('unknown')

  useEffect(() => {
    if (!hasTarget) return
    window.shinshell.sshHealth.subscribe(projectId)
    const off = window.shinshell.sshHealth.onStatus((e) => {
      if (e.projectId === projectId) setState(e.state)
    })
    return () => {
      off()
      window.shinshell.sshHealth.unsubscribe(projectId)
    }
  }, [projectId, hasTarget])

  if (!hasTarget) return null

  return <span className={`ssh-health-light ssh-health-${state}`} title={`SSH: ${state}`} />
}
