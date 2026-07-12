import type { JSX } from 'preact'
import { useCallback, useEffect, useState } from 'preact/hooks'
import { apiUrl } from '../apiBase'
import type { Pairing } from './PairingScreen'

interface RemoteDeviceEntry {
  id: string
  name?: string
  pairedAt: number
  lastSeenAt: number
  hasPushSubscription: boolean
  isThisDevice: boolean
}

interface PairedDevicesSectionProps {
  pairing: Pairing
  /** Called after revoking whichever device is *this* one — its bearer
   *  token is now dead, so there's no point waiting for the next request
   *  to 401 before forgetting the local pairing. */
  onForgetSelf: () => void
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
}

// § housekeeping (§7) — paired-devices screen: this device's own name (so
// you know which entry is "you" before revoking something), and a revoke
// button on every entry, itself included.
export default function PairedDevicesSection({ pairing, onForgetSelf }: PairedDevicesSectionProps): JSX.Element {
  const [devices, setDevices] = useState<RemoteDeviceEntry[] | null>(null)

  const refresh = useCallback(() => {
    fetch(apiUrl(pairing.serverUrl, '/devices'), {
      headers: { Authorization: `Bearer ${pairing.token}` }
    })
      .then((res) => (res.ok ? (res.json() as Promise<{ devices: RemoteDeviceEntry[] }>) : null))
      .then((body) => setDevices(body?.devices ?? []))
      .catch(() => setDevices([]))
  }, [pairing])

  useEffect(refresh, [refresh])

  const revoke = useCallback(
    async (device: RemoteDeviceEntry) => {
      await fetch(apiUrl(pairing.serverUrl, `/devices/${device.id}/revoke`), {
        method: 'POST',
        headers: { Authorization: `Bearer ${pairing.token}` }
      }).catch(() => {})
      if (device.isThisDevice) {
        onForgetSelf()
        return
      }
      refresh()
    },
    [pairing, refresh, onForgetSelf]
  )

  return (
    <div class="settings-section">
      <h3>Paired devices</h3>
      {devices === null ? (
        <p class="settings-note">Loading…</p>
      ) : devices.length === 0 ? (
        <p class="settings-note">No devices paired.</p>
      ) : (
        <div class="settings-devices-list">
          {devices.map((d) => (
            <div class="settings-device-row" key={d.id}>
              <div class="settings-device-info">
                <span class="settings-device-name">
                  {d.name ?? d.id}
                  {d.isThisDevice && <span class="settings-device-this"> (this device)</span>}
                </span>
                <span class="settings-device-meta">
                  paired {formatTimestamp(d.pairedAt)} · last seen {formatTimestamp(d.lastSeenAt)}
                  {d.hasPushSubscription ? ' · push enabled' : ' · push not set up'}
                </span>
              </div>
              <button class="settings-device-revoke" onClick={() => revoke(d)}>
                Revoke
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
