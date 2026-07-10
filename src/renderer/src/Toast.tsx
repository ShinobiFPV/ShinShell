import { useEffect } from 'react'

export interface ToastMessage {
  id: string
  text: string
  kind: 'success' | 'failure'
}

interface ToastProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

const AUTO_DISMISS_MS = 5000

// §UX3 — "outcomes without babysitting": a deploy result surfaces here even
// if you tabbed away mid-run, alongside the taskbar progress/flash and the
// failed-tab glow (TabStrip.tsx).
export default function Toast({ toasts, onDismiss }: ToastProps): JSX.Element | null {
  if (toasts.length === 0) return null
  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ToastMessage; onDismiss: (id: string) => void }): JSX.Element {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS)
    return () => clearTimeout(timer)
  }, [toast.id, onDismiss])

  return (
    <div className={`toast toast-${toast.kind}`} onMouseDown={() => onDismiss(toast.id)}>
      {toast.text}
    </div>
  )
}
