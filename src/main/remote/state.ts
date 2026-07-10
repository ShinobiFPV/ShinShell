import { app } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

// § ShinShell Remote — global (not per-project) persisted state: whether
// Remote is enabled, the VAPID keypair (generated once), paired devices,
// and any live pairing PIN. Follows appState.ts's read/write convention —
// this codebase hand-rolls this per state file rather than sharing a
// helper, so this does too.

export interface RemoteDeviceRecord {
  id: string
  name?: string
  /** sha256 of the device's bearer token — the raw token is returned once
   *  at pairing time and never persisted. */
  tokenHash: string
  pushSubscription?: PushSubscriptionJson
  pairedAt: number
  lastSeenAt: number
}

export interface PushSubscriptionJson {
  endpoint: string
  keys: { p256dh: string; auth: string }
}

export interface PendingPin {
  pin: string
  expiresAt: number
  attempts: number
}

export interface VapidKeys {
  publicKey: string
  privateKey: string
  subject: string
}

export interface RemoteState {
  enabled: boolean
  allowFullTerminalInput: boolean
  vapid: VapidKeys | null
  devices: RemoteDeviceRecord[]
  pendingPin: PendingPin | null
}

function defaultState(): RemoteState {
  return { enabled: false, allowFullTerminalInput: false, vapid: null, devices: [], pendingPin: null }
}

const remoteStatePath = (): string => join(app.getPath('userData'), 'remote.json')

export function loadRemoteState(): RemoteState {
  const path = remoteStatePath()
  if (!existsSync(path)) return defaultState()
  try {
    return { ...defaultState(), ...(JSON.parse(readFileSync(path, 'utf-8')) as Partial<RemoteState>) }
  } catch {
    return defaultState()
  }
}

export function saveRemoteState(state: RemoteState): void {
  const path = remoteStatePath()
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(state, null, 2), 'utf-8')
}
