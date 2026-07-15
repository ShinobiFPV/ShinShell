import { useCallback, useEffect, useState } from 'react'
import type { RemoteStatus, RemoteDevice } from '../../shared/ipc'

interface RemoteSettingsPanelProps {
  onClose: () => void
}

function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleString()
}

// § ShinShell Remote settings — clones EditProjectDialog's backdrop/header/
// footer modal recipe. Enable/disable, MagicDNS URL + QR pairing, paired
// devices with revoke, the allowFullTerminalInput warning toggle, and a
// test-notification button.
export default function RemoteSettingsPanel({ onClose }: RemoteSettingsPanelProps): JSX.Element {
  const [status, setStatus] = useState<RemoteStatus | null>(null)
  const [devices, setDevices] = useState<RemoteDevice[]>([])
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testState, setTestState] = useState<'idle' | 'sending' | 'sent'>('idle')

  const refreshDevices = useCallback(() => {
    window.shinshell.remote.getPairedDevices().then(setDevices)
  }, [])

  useEffect(() => {
    window.shinshell.remote.getStatus().then(setStatus)
    refreshDevices()
    return window.shinshell.remote.onStatus((s) => {
      setStatus(s)
      refreshDevices()
    })
  }, [refreshDevices])

  useEffect(() => {
    if (status?.running && status.url) {
      window.shinshell.remote.getQrDataUrl().then(setQrDataUrl)
    } else {
      setQrDataUrl(null)
    }
  }, [status?.running, status?.url])

  const toggleEnabled = useCallback(async () => {
    if (!status) return
    setBusy(true)
    setError(null)
    const result = await window.shinshell.remote.setEnabled(!status.enabled)
    setStatus(result.status)
    if (!result.ok && result.error) setError(result.error)
    setBusy(false)
  }, [status])

  const generatePin = useCallback(async () => {
    setBusy(true)
    setError(null)
    const s = await window.shinshell.remote.generatePairingPin()
    setStatus(s)
    setBusy(false)
  }, [])

  const revoke = useCallback(
    (id: string) => {
      window.shinshell.remote.revokeDevice(id)
      refreshDevices()
    },
    [refreshDevices]
  )

  const toggleFullInput = useCallback(() => {
    if (!status) return
    window.shinshell.remote.setAllowFullInput(!status.allowFullTerminalInput)
    setStatus({ ...status, allowFullTerminalInput: !status.allowFullTerminalInput })
  }, [status])

  const toggleAllowDeploy = useCallback(() => {
    if (!status) return
    window.shinshell.remote.setAllowDeploy(!status.allowDeploy)
    setStatus({ ...status, allowDeploy: !status.allowDeploy })
  }, [status])

  const toggleAllowProjectControl = useCallback(() => {
    if (!status) return
    window.shinshell.remote.setAllowProjectControl(!status.allowProjectControl)
    setStatus({ ...status, allowProjectControl: !status.allowProjectControl })
  }, [status])

  const sendTest = useCallback(async () => {
    setTestState('sending')
    await window.shinshell.remote.testNotification()
    setTestState('sent')
    setTimeout(() => setTestState('idle'), 3000)
  }, [])

  return (
    <div className="command-picker-backdrop" onMouseDown={onClose}>
      <div className="edit-project-dialog remote-settings-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-project-header">
          <span>ShinShell Remote</span>
          <button className="hotkey-close" onMouseDown={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="edit-project-body">
          <div className="remote-enable-row">
            <div>
              <div className="remote-enable-label">
                {status?.enabled ? 'Remote is enabled' : 'Remote is off'}
              </div>
              <div className="remote-enable-sub">
                Reachable only over Tailscale — never on your LAN or the open internet.
              </div>
            </div>
            <button className="btn-primary" disabled={busy || !status} onMouseDown={toggleEnabled}>
              {status?.enabled ? 'Disable' : 'Enable'}
            </button>
          </div>

          {error && <div className="edit-project-save-error">{error}</div>}
          {!error && status?.error && <div className="edit-project-save-error">{status.error}</div>}

          {status?.enabled && status.running && (
            <>
              <label className="edit-project-field">
                <span>Server address</span>
                <input value={status.url ?? ''} readOnly spellCheck={false} />
              </label>

              <div className="edit-project-field">
                <span>Pair a device</span>
                <div className="remote-pairing-row">
                  {qrDataUrl && <img className="remote-qr" src={qrDataUrl} alt="Scan to open ShinShell Remote" />}
                  <div className="remote-pairing-instructions">
                    <p>1. Scan the QR code (or open the URL above) on the phone.</p>
                    <p>2. Click "Generate pairing PIN" and type it into the phone.</p>
                    <button onMouseDown={generatePin} disabled={busy}>
                      Generate pairing PIN
                    </button>
                    {status.pendingPin && (
                      <div className="remote-pin" title="Expires in 5 minutes">
                        {status.pendingPin}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="edit-project-field">
                <span>Paired devices</span>
                {devices.length === 0 ? (
                  <div className="remote-devices-empty">No devices paired yet.</div>
                ) : (
                  <div className="remote-devices-list">
                    {devices.map((d) => (
                      <div key={d.id} className="remote-device-row">
                        <div className="remote-device-info">
                          <span className="remote-device-name">{d.name ?? d.id}</span>
                          <span className="remote-device-meta">
                            paired {formatTimestamp(d.pairedAt)} · last seen {formatTimestamp(d.lastSeenAt)}
                            {d.hasPushSubscription ? ' · push enabled' : ' · push not set up'}
                          </span>
                        </div>
                        <button className="remote-device-revoke" onMouseDown={() => revoke(d.id)}>
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="edit-project-field remote-full-input-row">
                <span>
                  <input
                    type="checkbox"
                    checked={status.allowFullTerminalInput}
                    onChange={toggleFullInput}
                  />{' '}
                  Allow input on plain terminal tabs, not just Claude Code
                </span>
                <span className="remote-full-input-warning">
                  ⚠ With this on, a paired phone can type into ANY terminal tab — not just answer Claude
                  Code prompts. Leave this off unless you specifically need it.
                </span>
              </label>

              <label className="edit-project-field remote-full-input-row">
                <span>
                  <input type="checkbox" checked={status.allowDeploy} onChange={toggleAllowDeploy} />{' '}
                  Allow remote deploy
                </span>
                <span className="remote-full-input-warning">
                  ⚠ With this on, a paired phone can see and fire a project's deploy commands. Dangerous
                  ones still require the same arm-then-confirm tap as the desktop deploy tab.
                </span>
              </label>

              <label className="edit-project-field remote-full-input-row">
                <span>
                  <input
                    type="checkbox"
                    checked={status.allowProjectControl}
                    onChange={toggleAllowProjectControl}
                  />{' '}
                  Allow remote open/close
                </span>
                <span className="remote-full-input-warning">
                  ⚠ With this on, a paired phone can see every configured project (not just open ones) and
                  open or close their windows on this desktop.
                </span>
              </label>

              <div className="edit-project-field">
                <button onMouseDown={sendTest} disabled={testState === 'sending'}>
                  {testState === 'sent' ? 'Sent!' : testState === 'sending' ? 'Sending…' : 'Send test notification'}
                </button>
              </div>
            </>
          )}
        </div>

        <div className="edit-project-footer">
          <button onMouseDown={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
