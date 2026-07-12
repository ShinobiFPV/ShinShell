import type { JSX } from 'preact'
import { useEffect, useState } from 'preact/hooks'
import type { RemoteDeployCommand } from '../ws/protocol'

interface DeployButtonProps {
  command: RemoteDeployCommand
  accentColor: string
  onRun: (commandId: string) => void
}

// § remote deploy (§5) — mirrors the desktop's own arm-to-confirm exactly:
// a non-dangerous command fires on the first tap; a dangerous one arms
// instead, showing precisely what's about to run (the fully-substituted
// command string, real host included) with a 3s accent-color countdown,
// and only fires on a second tap within that window — otherwise it quietly
// disarms. See ProjectWindow.tsx's requestConfirm/ARM_WINDOW_MS on the
// desktop side; same 3000ms window, same "second tap within the window
// fires it" rule.
const ARM_WINDOW_MS = 3000

export default function DeployButton({ command, accentColor, onRun }: DeployButtonProps): JSX.Element {
  const [armedUntil, setArmedUntil] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (armedUntil === null) return
    const tick = setInterval(() => setNow(Date.now()), 200)
    const disarm = setTimeout(() => setArmedUntil(null), Math.max(0, armedUntil - Date.now()))
    return () => {
      clearInterval(tick)
      clearTimeout(disarm)
    }
  }, [armedUntil])

  const armed = armedUntil !== null && now < armedUntil
  const secondsLeft = armed ? Math.max(1, Math.ceil((armedUntil! - now) / 1000)) : 0

  const handleClick = (e: JSX.TargetedMouseEvent<HTMLButtonElement>): void => {
    // Cards themselves are tap-to-open; stop that from firing when the tap
    // landed on a deploy button nested inside one.
    e.stopPropagation()
    if (!command.dangerous) {
      onRun(command.id)
      return
    }
    if (armed) {
      setArmedUntil(null)
      onRun(command.id)
      return
    }
    setNow(Date.now())
    setArmedUntil(Date.now() + ARM_WINDOW_MS)
  }

  return (
    <button
      type="button"
      class={`deploy-btn${command.dangerous ? ' deploy-btn-dangerous' : ''}${armed ? ' deploy-btn-armed' : ''}`}
      style={armed ? ({ '--arm-accent': accentColor } as Record<string, string>) : undefined}
      onClick={handleClick}
      title={armed ? command.command : `${command.label} → ${command.command}`}
    >
      {armed ? `Tap to confirm (${secondsLeft})` : command.label}
    </button>
  )
}
