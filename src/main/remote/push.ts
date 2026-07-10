// § ShinShell Remote — VAPID setup + web push send. Keys are generated once
// and persisted in remote.json; sending is a plain outbound HTTPS call to
// FCM/Mozilla's push service, independent of whether the phone is currently
// on the tailnet — only *opening* the notification (reaching ShinShell's
// Tailscale-only origin) requires that.
import webpush from 'web-push'
import { loadRemoteState, saveRemoteState, type RemoteState, type PushSubscriptionJson } from './state'

const VAPID_SUBJECT = 'mailto:shinobifpv@gmail.com'

let initialized = false

/** Generates the VAPID keypair on first call (persisted thereafter) and
 *  configures web-push. Safe to call repeatedly — a no-op once initialized
 *  for this process. */
export function ensureVapid(): RemoteState {
  const state = loadRemoteState()
  if (!state.vapid) {
    const { publicKey, privateKey } = webpush.generateVAPIDKeys()
    state.vapid = { publicKey, privateKey, subject: VAPID_SUBJECT }
    saveRemoteState(state)
  }
  if (!initialized) {
    webpush.setVapidDetails(state.vapid.subject, state.vapid.publicKey, state.vapid.privateKey)
    initialized = true
  }
  return state
}

export function getVapidPublicKey(): string {
  return ensureVapid().vapid!.publicKey
}

interface NotifyPayload {
  title: string
  body: string
  sessionId: string
}

/** Sends to every paired device with a stored push subscription, in
 *  parallel — one dead subscription (device uninstalled the PWA, etc.)
 *  shouldn't block the others. Dead subscriptions (404/410, per the push
 *  service's own semantics for "this endpoint no longer exists") are
 *  pruned from remote.json. */
export async function notifyAllDevices(payload: NotifyPayload): Promise<void> {
  ensureVapid()
  const state = loadRemoteState()
  const targets = state.devices.filter((d) => d.pushSubscription)
  if (targets.length === 0) return

  const results = await Promise.allSettled(
    targets.map((d) => sendOne(d.pushSubscription!, payload))
  )

  const deadEndpoints = new Set<string>()
  results.forEach((result, i) => {
    if (result.status === 'rejected' && isGone(result.reason)) {
      deadEndpoints.add(targets[i].pushSubscription!.endpoint)
    }
  })
  if (deadEndpoints.size > 0) {
    const fresh = loadRemoteState()
    for (const d of fresh.devices) {
      if (d.pushSubscription && deadEndpoints.has(d.pushSubscription.endpoint)) {
        d.pushSubscription = undefined
      }
    }
    saveRemoteState(fresh)
  }
}

function isGone(err: unknown): boolean {
  return (
    err instanceof webpush.WebPushError && (err.statusCode === 404 || err.statusCode === 410)
  )
}

async function sendOne(subscription: PushSubscriptionJson, payload: NotifyPayload): Promise<void> {
  await webpush.sendNotification(
    subscription as unknown as webpush.PushSubscription,
    JSON.stringify(payload),
    { TTL: 60, urgency: 'high' }
  )
}
