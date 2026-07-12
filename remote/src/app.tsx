import type { JSX } from 'preact'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import PairingScreen, { type Pairing } from './components/PairingScreen'
import Dashboard from './components/Dashboard'
import SessionList from './components/SessionList'
import TerminalView from './components/TerminalView'
import { MultiplexClient } from './ws/MultiplexClient'
import type { RemoteHealth, RemoteProject } from './ws/protocol'
import { subscribeToPush, isPushSubscribed } from './push/registerPush'

const STORAGE_KEY = 'shinshell-remote-pairing'
const PROJECTS_POLL_MS = 5000

type Screen = 'home' | 'session'

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

/** Pulls `?tab=<sessionId>` off the URL (set by the SW's notificationclick
 *  handler — see sw.ts) exactly once per load, then scrubs it so a refresh
 *  or the browser's own back button doesn't keep re-jumping into that
 *  session. Returns null once consumed or if it was never present. */
function consumeDeepLinkTabId(): string | null {
  const params = new URLSearchParams(location.search)
  const tabId = params.get('tab')
  if (tabId) history.replaceState(null, '', location.pathname)
  return tabId
}

export default function App(): JSX.Element {
  const [pairing, setPairing] = useState<Pairing | null>(loadPairing)
  const [projects, setProjects] = useState<RemoteProject[]>([])
  const [health, setHealth] = useState<RemoteHealth | null>(null)
  const [screen, setScreen] = useState<Screen>('home')
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const clientRef = useRef<MultiplexClient | null>(null)
  const deepLinkTabId = useRef<string | null>(consumeDeepLinkTabId())

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

  const refreshHealth = useCallback(async () => {
    if (!pairing) return
    try {
      const res = await fetch(`${pairing.serverUrl}/api/health`)
      if (!res.ok) {
        setHealth(null)
        return
      }
      setHealth((await res.json()) as RemoteHealth)
    } catch {
      setHealth(null)
    }
  }, [pairing])

  useEffect(() => {
    if (!pairing) return
    refreshProjects()
    refreshHealth()
    const timer = setInterval(() => {
      refreshProjects()
      refreshHealth()
    }, PROJECTS_POLL_MS)
    return () => clearInterval(timer)
  }, [pairing, refreshProjects, refreshHealth])

  // Jump straight into a session view once the deep-linked tab actually
  // shows up in a poll (it may not be there yet on the very first response
  // right after a cold app launch woken by the notification itself).
  useEffect(() => {
    const tabId = deepLinkTabId.current
    if (!tabId) return
    const owningProject = projects.find((p) => p.tabs.some((t) => t.id === tabId))
    if (!owningProject) return
    deepLinkTabId.current = null
    setActiveTabId(tabId)
    setScreen('session')
  }, [projects])

  const handlePaired = useCallback((p: Pairing) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
    setPairing(p)
  }, [])

  const forgetDevice = useCallback(() => {
    localStorage.removeItem(STORAGE_KEY)
    setPairing(null)
    setProjects([])
    setHealth(null)
    setScreen('home')
    setActiveTabId(null)
    setSettingsOpen(false)
  }, [])

  const openProject = useCallback((projectId: string) => {
    const project = projects.find((p) => p.id === projectId)
    if (!project) return
    const primaryTab = project.tabs.find((t) => t.type === 'claude-code') ?? project.tabs[0] ?? null
    setActiveTabId(primaryTab?.id ?? null)
    setScreen('session')
  }, [projects])

  const goHome = useCallback(() => {
    setScreen('home')
    setActiveTabId(null)
  }, [])

  if (!pairing) {
    return <PairingScreen onPaired={handlePaired} />
  }

  const selectedProject = projects.find((p) => p.tabs.some((t) => t.id === activeTabId)) ?? null
  const activeTab = selectedProject?.tabs.find((t) => t.id === activeTabId) ?? null

  return (
    <div class="app">
      <div class="app-topbar">
        {screen === 'session' ? (
          <>
            <button class="app-back-btn" onClick={goHome} title="Back to dashboard">
              ←
            </button>
            <SessionList
              projects={selectedProject ? [selectedProject] : []}
              activeTabId={activeTabId}
              onSelect={setActiveTabId}
            />
          </>
        ) : (
          <div class="app-topbar-title">ShinShell Remote</div>
        )}
        <button class="app-settings-btn" onClick={() => setSettingsOpen(true)} title="Settings">
          ⚙
        </button>
      </div>

      {!connected && <div class="offline-banner">Reconnecting to ShinShell…</div>}

      <div class="app-main">
        {screen === 'home' ? (
          <Dashboard projects={projects} health={health} onSelectProject={openProject} />
        ) : activeTab && clientRef.current ? (
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
