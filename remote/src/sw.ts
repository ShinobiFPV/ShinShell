// @ts-nocheck — service worker global scope (`self` as ServiceWorkerGlobalScope,
// FetchEvent, PushEvent, NotificationEvent) conflicts with the DOM lib the
// rest of this project's tsconfig.json uses for `self: Window`. Vite/esbuild
// don't type-check at build time (only `tsc --noEmit` does, over src/**
// generally), so excluding just this one file from strict checking is the
// standard, low-risk way to write a TS service worker without a second
// tsconfig-per-file split. Runtime behavior is unaffected.
//
// § ShinShell Remote service worker — injectManifest mode (see
// vite.config.ts): the plugin injects the precache manifest at build time
// via self.__WB_MANIFEST, everything else here is hand-written. WebSocket
// traffic is never intercepted by the fetch handler below (browsers route
// WS upgrades outside the Fetch API entirely), so this is safe alongside
// MultiplexClient's live connection.
import { precacheAndRoute } from 'workbox-precaching'
import { idbGet } from './idb'

precacheAndRoute(self.__WB_MANIFEST)

self.addEventListener('install', () => {
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

// App-shell offline fallback: only for navigations (loading the app itself),
// not for API/WS calls — those should fail normally so the UI can show its
// own "reconnecting" state instead of a generic browser network error.
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() => caches.match('/offline.html')))
})

// § actionable notifications (§3) — [y]/[n] are real notification actions
// where the platform supports them (Chrome/Android does; iOS Safari does
// not render `actions` at all as of this writing, so there it silently
// falls back to tap-to-open, which is the existing behavior below).
self.addEventListener('push', (event) => {
  let data = { title: 'ShinShell Remote', body: '', sessionId: '' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // non-JSON payload — fall back to the defaults above
  }
  const actionable = Boolean(data.sessionId) && data.sessionId !== 'test'
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.sessionId || undefined,
      renotify: Boolean(data.sessionId),
      data,
      actions: actionable
        ? [
            { action: 'yes', title: 'y' },
            { action: 'no', title: 'n' },
            { action: 'open', title: 'Open' }
          ]
        : undefined
    })
  )
})

interface StoredPairing {
  serverUrl: string
  token: string
}

/** Fires the y/n key straight at the API from the SW's own fetch — no page,
 *  no window — using the pairing this SW mirrored into IndexedDB (see
 *  idb.ts / app.tsx). Silently no-ops if unpaired or offline; there's no
 *  app UI open to report the failure to, and the notification itself is
 *  already gone by the time this runs. */
async function sendQuickReply(sessionId: string, key: 'y' | 'n'): Promise<void> {
  const pairing = await idbGet<StoredPairing>('pairing')
  if (!pairing) return
  try {
    await fetch(`${pairing.serverUrl}/api/tabs/${sessionId}/keys`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pairing.token}` },
      body: JSON.stringify({ key })
    })
  } catch {
    // offline / ShinShell unreachable — nothing more to do from here
  }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const sessionId = event.notification.data?.sessionId

  if ((event.action === 'yes' || event.action === 'no') && sessionId) {
    event.waitUntil(sendQuickReply(sessionId, event.action === 'yes' ? 'y' : 'n'))
    return
  }

  event.waitUntil(self.clients.openWindow(sessionId ? `/?tab=${sessionId}` : '/'))
})
