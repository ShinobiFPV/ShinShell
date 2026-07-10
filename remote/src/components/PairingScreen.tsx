import type { JSX } from 'preact'
import { useState } from 'preact/hooks'

export interface Pairing {
  serverUrl: string
  token: string
  vapidPublicKey: string
}

interface PairingScreenProps {
  onPaired: (pairing: Pairing) => void
}

function guessDeviceName(): string {
  const ua = navigator.userAgent
  if (/iphone/i.test(ua)) return 'iPhone'
  if (/ipad/i.test(ua)) return 'iPad'
  if (/android/i.test(ua)) return 'Android'
  return 'Phone'
}

// § ShinShell Remote pairing — the PIN is generated from ShinShell's own
// settings panel (read it there, type it here); this screen never
// generates or displays a PIN itself.
export default function PairingScreen({ onPaired }: PairingScreenProps): JSX.Element {
  const [serverUrl, setServerUrl] = useState(location.origin)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: Event): Promise<void> => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    const base = serverUrl.trim().replace(/\/$/, '')
    try {
      const res = await fetch(`${base}/api/pair`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin, deviceName: guessDeviceName() })
      })
      const body = (await res.json()) as { token?: string; vapidPublicKey?: string; error?: string }
      if (!res.ok || !body.token || !body.vapidPublicKey) {
        setError(body.error ?? 'Pairing failed')
        setBusy(false)
        return
      }
      onPaired({ serverUrl: base, token: body.token, vapidPublicKey: body.vapidPublicKey })
    } catch {
      setError('Could not reach the server — check the address and that this device is on the tailnet.')
      setBusy(false)
    }
  }

  return (
    <div class="pairing-screen">
      <h1>ShinShell Remote</h1>
      <p>Enter the 6-digit PIN shown in ShinShell's Remote settings panel.</p>
      <form onSubmit={submit}>
        <label>
          Server address
          <input
            value={serverUrl}
            onInput={(e) => setServerUrl((e.target as HTMLInputElement).value)}
            spellcheck={false}
          />
        </label>
        <label>
          Pairing PIN
          <input
            value={pin}
            onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            maxLength={6}
            autoFocus
            class="pairing-pin-input"
          />
        </label>
        {error && <div class="pairing-error">{error}</div>}
        <button type="submit" disabled={busy || pin.length !== 6}>
          {busy ? 'Pairing…' : 'Pair'}
        </button>
      </form>
    </div>
  )
}
