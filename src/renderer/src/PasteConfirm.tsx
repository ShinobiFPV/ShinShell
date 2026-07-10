import { useEffect, useRef, useState } from 'react'

interface PasteConfirmProps {
  lineCount: number
  onConfirm: (skipNextTime: boolean) => void
  onCancel: () => void
}

// § clipboard fix — the multiline-paste guard: accidentally pasting a
// multi-line block into an elevated ssh session is exactly the class of
// accident this app exists to prevent (§UX2's arm-to-confirm is the same
// philosophy). Single-line pastes never hit this — see Terminal.tsx's
// requestPaste().
export default function PasteConfirm({ lineCount, onConfirm, onCancel }: PasteConfirmProps): JSX.Element {
  const [skip, setSkip] = useState(false)
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    confirmRef.current?.focus()

    // Capture phase, and stopPropagation here specifically: xterm's hidden
    // textarea still has DOM focus underneath this overlay, so Enter/Esc
    // must never also reach its own bubble-phase keydown handler (which
    // would otherwise also send a literal \r or escape byte to the pty).
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault()
        e.stopPropagation()
        onConfirm(skip)
      } else if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [skip, onConfirm, onCancel])

  return (
    <div className="paste-confirm">
      <span className="paste-confirm-question">Paste {lineCount} lines?</span>
      <label className="paste-confirm-skip">
        <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} />
        Don't ask again
      </label>
      <div className="paste-confirm-actions">
        <button onMouseDown={onCancel}>Cancel</button>
        <button ref={confirmRef} className="btn-primary" onMouseDown={() => onConfirm(skip)}>
          Paste
        </button>
      </div>
    </div>
  )
}
