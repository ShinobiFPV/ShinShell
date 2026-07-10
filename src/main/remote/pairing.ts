// § ShinShell Remote — PIN pairing + device token issuance/verification.
// The PIN is generated from the ShinShell side (settings panel "Generate
// pairing PIN") and shown there for the human to read and type into the
// phone — the phone never triggers PIN generation itself, so pairing works
// even before any phone has ever connected.
import { randomBytes, randomInt, createHash, timingSafeEqual } from 'crypto'
import { loadRemoteState, saveRemoteState, type RemoteDeviceRecord, type PendingPin } from './state'

const PIN_TTL_MS = 5 * 60 * 1000
const MAX_PIN_ATTEMPTS = 5

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex')
}

export function generatePin(): PendingPin {
  const state = loadRemoteState()
  const pin = String(randomInt(0, 1_000_000)).padStart(6, '0')
  const pending: PendingPin = { pin, expiresAt: Date.now() + PIN_TTL_MS, attempts: 0 }
  state.pendingPin = pending
  saveRemoteState(state)
  return pending
}

export type PairResult =
  | { ok: true; token: string; device: RemoteDeviceRecord }
  | { ok: false; error: string }

/** Verifies the submitted PIN and, on success, issues a new device token in
 *  one step (the raw token is returned only here — every later request
 *  proves identity via its hash, per verifyToken below). */
export function submitPin(submitted: string, deviceName?: string): PairResult {
  const state = loadRemoteState()
  const pending = state.pendingPin
  if (!pending) return { ok: false, error: 'No pairing in progress — generate a PIN in ShinShell first.' }
  if (Date.now() > pending.expiresAt) {
    state.pendingPin = null
    saveRemoteState(state)
    return { ok: false, error: 'PIN expired — generate a new one in ShinShell.' }
  }
  if (pending.pin !== submitted) {
    pending.attempts += 1
    if (pending.attempts >= MAX_PIN_ATTEMPTS) {
      state.pendingPin = null
      saveRemoteState(state)
      return { ok: false, error: 'Too many wrong attempts — generate a new PIN in ShinShell.' }
    }
    saveRemoteState(state)
    return { ok: false, error: 'Incorrect PIN.' }
  }

  const token = randomBytes(32).toString('base64url')
  const device: RemoteDeviceRecord = {
    id: randomBytes(8).toString('hex'),
    name: deviceName,
    tokenHash: sha256(token),
    pairedAt: Date.now(),
    lastSeenAt: Date.now()
  }
  state.pendingPin = null
  state.devices.push(device)
  saveRemoteState(state)
  return { ok: true, token, device }
}

/** Verifies a bearer token against every paired device's stored hash via a
 *  constant-time compare, and bumps lastSeenAt on success. Called on every
 *  authenticated REST/WS request. */
export function verifyToken(token: string): RemoteDeviceRecord | null {
  const state = loadRemoteState()
  const hash = Buffer.from(sha256(token), 'hex')
  const match = state.devices.find((d) => {
    const stored = Buffer.from(d.tokenHash, 'hex')
    return stored.length === hash.length && timingSafeEqual(stored, hash)
  })
  if (!match) return null
  match.lastSeenAt = Date.now()
  saveRemoteState(state)
  return match
}

export function revokeDevice(id: string): void {
  const state = loadRemoteState()
  state.devices = state.devices.filter((d) => d.id !== id)
  saveRemoteState(state)
}
