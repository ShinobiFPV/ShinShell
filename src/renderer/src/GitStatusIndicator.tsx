import { useEffect, useState } from 'react'
import type { GitStatus } from '../../shared/ipc'

interface GitStatusIndicatorProps {
  workingDir: string
}

const POLL_INTERVAL_MS = 30_000

// §6.12 — branch name + dirty indicator per project, in the tab strip.
export default function GitStatusIndicator({ workingDir }: GitStatusIndicatorProps): JSX.Element | null {
  const [status, setStatus] = useState<GitStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    const check = (): void => {
      window.shinshell.gitStatus.get(workingDir).then((s) => {
        if (!cancelled) setStatus(s)
      })
    }
    check()
    const timer = setInterval(check, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workingDir])

  if (!status) return null

  return (
    <span className={`git-status${status.dirty ? ' git-status-dirty' : ''}`} title={status.dirty ? 'Uncommitted changes' : 'Clean'}>
      <span className="git-status-dot" />
      {status.branch}
    </span>
  )
}
