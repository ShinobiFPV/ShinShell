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

self.addEventListener('push', (event) => {
  let data = { title: 'ShinShell Remote', body: '', sessionId: '' }
  try {
    if (event.data) data = { ...data, ...event.data.json() }
  } catch {
    // non-JSON payload — fall back to the defaults above
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.sessionId || undefined,
      renotify: Boolean(data.sessionId),
      data
    })
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const sessionId = event.notification.data?.sessionId
  event.waitUntil(self.clients.openWindow(sessionId ? `/?tab=${sessionId}` : '/'))
})
