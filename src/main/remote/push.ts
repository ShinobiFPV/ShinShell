// § ShinShell Remote — VAPID setup + web push send. Keys are generated once
// and persisted in remote.json; sending is a plain outbound HTTPS call to
// FCM/Mozilla's push service, independent of whether the phone is currently
// on the tailnet — only *opening* the notification (reaching ShinShell's
// Tailscale-only origin) requires that.
import webpush from 'web-push'
import {
  loadRemoteState,
  saveRemoteState,
  type QuietHours,
  type RemoteState,
  type PushSubscriptionJson
} from './state'

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
  /** Owning project, when there is one — gates per-device mute/quiet-hours
   *  filtering below. Absent for cross-project pushes (e.g. the test
   *  notification), which always go through unfiltered. */
  projectId?: string
}

function isQuietNow(quietHours: QuietHours | null | undefined): boolean {
  if (!quietHours) return false
  const { startMinute, endMinute } = quietHours
  if (startMinute === endMinute) return false // degenerate window — treat as off
  const minutes = new Date().getHours() * 60 + new Date().getMinutes()
  return startMinute < endMinute
    ? minutes >= startMinute && minutes < endMinute
    : minutes >= startMinute || minutes < endMinute // wraps midnight, e.g. 22:00–07:00
}

/** Sends to every paired device with a stored push subscription, in
 *  parallel — one dead subscription (device uninstalled the PWA, etc.)
 *  shouldn't block the others. Dead subscriptions (404/410, per the push
 *  service's own semantics for "this endpoint no longer exists") are
 *  pruned from remote.json.
 *
 *  `bypassFilters` skips per-device mute/quiet-hours gating — used only by
 *  the "send test notification" button, since a deliberate user action to
 *  test push shouldn't get silently swallowed by whatever quiet-hours
 *  window happens to be active right now. */
export async function notifyAllDevices(
  payload: NotifyPayload,
  opts?: { bypassFilters?: boolean }
): Promise<void> {
  ensureVapid()
  const state = loadRemoteState()
  const targets = state.devices.filter((d) => {
    if (!d.pushSubscription) return false
    if (opts?.bypassFilters) return true
    if (payload.projectId && (d.notifyMutedProjectIds ?? []).includes(payload.projectId)) return false
    if (isQuietNow(d.quietHours)) return false
    return true
  })
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
