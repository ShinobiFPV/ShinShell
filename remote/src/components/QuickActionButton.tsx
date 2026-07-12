import type { JSX } from 'preact'
import { useRef, useState } from 'preact/hooks'

interface QuickActionButtonProps {
  label: string
  preview: string
  disabled?: boolean
  onPress: () => void
}

const LONG_PRESS_MS = 450

// § Session view polish (§2) — a quick-action button (default control key or
// user-defined snippet) that fires `onPress` on a normal tap but, held past
// LONG_PRESS_MS, shows `preview` (exactly what it sends) instead of firing —
// "Long-press any action shows what it sends."
export default function QuickActionButton({
  label,
  preview,
  disabled,
  onPress
}: QuickActionButtonProps): JSX.Element {
  const [showPreview, setShowPreview] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const longPressed = useRef(false)

  const clearTimer = (): void => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = null
  }

  const start = (): void => {
    if (disabled) return
    longPressed.current = false
    clearTimer()
    timerRef.current = setTimeout(() => {
      longPressed.current = true
      setShowPreview(true)
    }, LONG_PRESS_MS)
  }

  const end = (): void => {
    clearTimer()
    if (showPreview) {
      setShowPreview(false)
      return
    }
    if (!longPressed.current && !disabled) onPress()
  }

  const cancel = (): void => {
    clearTimer()
    setShowPreview(false)
  }

  return (
    <span class="quick-action-wrap">
      {showPreview && <span class="quick-action-preview">{preview}</span>}
      <button
        type="button"
        disabled={disabled}
        onPointerDown={start}
        onPointerUp={end}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        {label}
      </button>
    </span>
  )
}
