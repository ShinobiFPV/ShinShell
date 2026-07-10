import type { JSX } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import PairingScreen, { type Pairing } from './components/PairingScreen'
import SessionList from './components/SessionList'
import TerminalView from './components/TerminalView'
import { MultiplexClient } from './ws/MultiplexClient'
import type { RemoteProject } from './ws/protocol'
import { subscribeToPush, isPushSubscribed } from './push/registerPush'

const STORAGE_KEY = 'shinshell-remote-pairing'
const PROJECTS_POLL_MS = 5000

function loadPairing(): Pairing | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as Pairing) : null
  } catch {
    return null
  }
}

function wsUrlFor(serverUrl: string): string {
  return `${serverUrl.replace(/^http/, 'ws')}/api/ws`
}

function SettingsOverlay({
  onClose,
  onForget
}: {
  onClose: () => void
  onForget: () => void
}): JSX.Element {
  const [pushOn, setPushOn] = useState<boolean | null>(null)

  useEffect(() => {
    isPushSubscribed().then(setPushOn)
  }, [])

  const enablePush = useCallback(async () => {
    const pairing = loadPairing()
    if (!pairing) return
    const subscription = await subscribeToPush(pairing.vapidPublicKey)
    if (!subscription) {
      setPushOn(false)
      return
    }
    await fetch(`${pairing.serverUrl}/api/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pairing.token}` },
      body: JSON.stringify({ subscription })
    })
    setPushOn(true)
  }, [])

  return (
    <div class="settings-overlay" onClick={onClose}>
      <div class="settings-panel" onClick={(e) => e.stopPropagation()}>
        <h2>Settings</h2>
        <button disabled={pushOn === true} onClick={enablePush}>
          {pushOn === true ? 'Notifications on' : 'Enable notifications'}
        </button>
        <p class="settings-note">
          iOS: install this app to your Home Screen first (Share → Add to Home Screen) — Safari tabs
          can't receive push notifications.
        </p>
        <button class="settings-forget" onClick={onForget}>
          Forget this device
        </button>
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  )
}

export default function App(): JSX.Element {
  const [pairing, setPairing] = useState<Pairing | null>(loadPairing)
  const [projects, setProjects] = useState<RemoteProject[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const clientRef = useRef<MultiplexClient | null>(null)

  useEffect(() => {
    if (!pairing) return
    const client = new MultiplexClient(wsUrlFor(pairing.serverUrl), pairing.token)
    clientRef.current = client
    const off = client.onConnectionChange(setConnected)
    client.connect()
    return () => {
      off()
      client.close()
      clientRef.current = null
    }
  }, [pairing])

  const refreshProjects = useCallback(async () => {
    if (!pairing) return
    try {
      const res = await fetch(`${pairing.serverUrl}/api/projects`, {
        headers: { Authorization: `Bearer ${pairing.token}` }
      })
      if (!res.ok) return
      const body = (await res.json()) as { projects: RemoteProject[] }
      setProjects(body.projects)
    } catch {
      // offline — the "ShinShell is offline" banner below already covers this
    }
  }, [pairing])

  useEffect(() => {
    if (!pairing) return
    refreshProjects()
    const timer = setInterval(refreshProjects, PROJECTS_POLL_MS)
    return () => clearInterval(timer)
  }, [pairing, refreshProjects])

  const handlePaired = useCallback((p: Pairing) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
    setPairing(p)
  }, [])

  const forgetDevice = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setPairing(null)
    setProjects([])
    setActiveTabId(null)
    setSettingsOpen(false)
  }, [])

  if (!pairing) {
    return <PairingScreen onPaired={handlePaired} />
  }

  const allTabs = projects.flatMap((p) => p.tabs.map((t) => ({ ...t, project: p })))
  const activeTab = allTabs.find((t) => t.id === activeTabId) ?? null

  return (
    <div class="app">
      <div class="app-topbar">
        <SessionList projects={projects} activeTabId={activeTabId} onSelect={setActiveTabId} />
        <button class="app-settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">
          ⚙
        </button>
      </div>

      {!connected && <div class="offline-banner">Reconnecting to ShinShell…</div>}

      <div class="app-main">
        {activeTab && clientRef.current ? (
          <TerminalView
            key={activeTab.id}
            tabId={activeTab.id}
            allowInput={activeTab.type === 'claude-code'}
            client={clientRef.current}
            serverUrl={pairing.serverUrl}
            token={pairing.token}
          />
        ) : (
          <div class="app-empty">Select a session above</div>
        )}
      </div>

      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} onForget={forgetDevice} />}
    </div>
  )
}
