// Shared IPC channel names + payload types, imported by both main and renderer
// (via preload) so the two sides can't drift out of sync on shape.

export const IPC = {
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  systemHomeDir: 'system:homeDir',
  systemIsElevated: 'system:isElevated',
  systemRepair: 'system:repair',
  projectsList: 'projects:list',
  projectsGet: 'projects:get',
  projectsSaveRestoreState: 'projects:saveRestoreState',
  projectsCreateFromFolder: 'projects:createFromFolder',
  projectsValidate: 'projects:validate',
  projectsSuggestFixes: 'projects:suggestFixes',
  projectsUpdate: 'projects:update',
  projectsUpdated: 'projects:updated',
  windowOpenProject: 'window:openProject',
  windowOpenLauncher: 'window:openLauncher',
  windowNewTerminalTab: 'window:newTerminalTab',
  windowSetProgress: 'window:setProgress',
  windowFlash: 'window:flash',
  windowDisplayChanged: 'window:displayChanged',
  commandsRunBackground: 'commands:runBackground',
  claudeChatCreate: 'claudeChat:create',
  claudeChatSetBounds: 'claudeChat:setBounds',
  claudeChatSetVisible: 'claudeChat:setVisible',
  claudeChatBack: 'claudeChat:back',
  claudeChatForward: 'claudeChat:forward',
  claudeChatReload: 'claudeChat:reload',
  claudeChatDestroy: 'claudeChat:destroy',
  claudeChatNavState: 'claudeChat:navState',
  claudeChatAuthHint: 'claudeChat:authHint',
  filesRead: 'files:read',
  filesWrite: 'files:write',
  filesShowOpenDialog: 'files:showOpenDialog',
  filesShowSaveDialog: 'files:showSaveDialog',
  filesShowOpenFolderDialog: 'files:showOpenFolderDialog',
  filesPathIsDirectory: 'files:pathIsDirectory',
  scratchpadLoad: 'scratchpad:load',
  scratchpadSave: 'scratchpad:save',
  deployHistoryGet: 'deployHistory:get',
  deployHistoryAppend: 'deployHistory:append',
  sshHealthSubscribe: 'sshHealth:subscribe',
  sshHealthUnsubscribe: 'sshHealth:unsubscribe',
  sshHealthStatus: 'sshHealth:status',
  portsList: 'ports:list',
  portsKill: 'ports:kill',
  gitStatusGet: 'gitStatus:get',
  watchSyncSetEnabled: 'watchSync:setEnabled',
  watchSyncGetActivity: 'watchSync:getActivity',
  watchSyncActivity: 'watchSync:activity',
  updaterCheck: 'updater:check',
  remoteGetStatus: 'remote:getStatus',
  remoteSetEnabled: 'remote:setEnabled',
  remoteGeneratePairingPin: 'remote:generatePairingPin',
  remoteGetPairedDevices: 'remote:getPairedDevices',
  remoteRevokeDevice: 'remote:revokeDevice',
  remoteSetAllowFullInput: 'remote:setAllowFullInput',
  remoteTestNotification: 'remote:testNotification',
  remoteGetQrDataUrl: 'remote:getQrDataUrl',
  remoteStatus: 'remote:status',
  clipboardReadText: 'clipboard:readText',
  clipboardWriteText: 'clipboard:writeText',
  settingsGet: 'settings:get',
  settingsSetSkipMultilinePasteGuard: 'settings:setSkipMultilinePasteGuard'
} as const

export interface PtySpawnOptions {
  id: string
  cwd: string
  cols: number
  rows: number
  shell?: string
  env?: Record<string, string>
  /** If set, spawns this single command directly (not an interactive shell)
   *  so the pty's exit code is the command's own — used by the deploy tab
   *  (§6.7) to record real exit codes in history. */
  oneShotCommand?: string
  /** 'terminal' | 'claude-code' — tags the session so ShinShell Remote can
   *  scope its waiting-for-input heuristic and input gating (§ Remote) to
   *  claude-code panes only. Absent for one-shot (deploy) spawns. */
  tabKind?: 'terminal' | 'claude-code'
}

export interface PtyDataEvent {
  id: string
  data: string
}

export interface PtyExitEvent {
  id: string
  exitCode: number
}

export interface BackgroundCommandOptions {
  command: string
  cwd: string
  shell: string
  env: Record<string, string>
}

export interface ViewBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface ClaudeChatNavState {
  id: string
  canGoBack: boolean
  canGoForward: boolean
  title: string
  url: string
  loading: boolean
}

/** Pushed when Google's sign-in flow (or claude.ai itself) lands on a page
 *  that looks like an auth rejection (e.g. "disallowed_useragent") — the
 *  tab surfaces `message` as a dismissible hint pointing at email-code
 *  login instead of leaving the user stuck on a dead-end error page. */
export interface ClaudeChatAuthHint {
  id: string
  message: string
}

export interface DeployRun {
  commandId: string
  commandLabel: string
  startedAt: number
  durationMs: number
  exitCode: number
}

export type SshHealthState = 'checking' | 'up' | 'down' | 'unknown'

export interface SshHealthStatus {
  projectId: string
  state: SshHealthState
  lastCheckedAt: number | null
}

export interface PortEntry {
  port: number
  pid: number
  processName: string
  protocol: 'TCP' | 'UDP'
}

export interface GitStatus {
  branch: string
  dirty: boolean
}

export interface WatchSyncActivityEntry {
  projectId: string
  timestamp: number
  changedPath: string
  commandLabel: string
  success: boolean
}

/** § ShinShell Remote — pushed to the launcher whenever the remote server's
 *  lifecycle state changes (enabled/disabled, bound address, a new pairing
 *  PIN, or a start failure) so RemoteBadge/RemoteSettingsPanel stay live
 *  without polling. */
export interface RemoteStatus {
  enabled: boolean
  running: boolean
  /** e.g. "https://scarlettwitch.tail9249a1.ts.net:8443" once bound. */
  url: string | null
  error: string | null
  pairedDeviceCount: number
  /** Set only while a pairing PIN is live (5 min window); cleared on
   *  success, expiry, or the attempt cap being hit. */
  pendingPin: string | null
  /** Off by default — whether remote input is allowed on plain terminal
   *  tabs, not just claude-code ones. See RemoteSettingsPanel's warning. */
  allowFullTerminalInput: boolean
}

export interface RemoteDevice {
  id: string
  name?: string
  pairedAt: number
  lastSeenAt: number
  hasPushSubscription: boolean
}

export interface RemoteEnableResult {
  ok: boolean
  error?: string
  status: RemoteStatus
}

/** § clipboard fix — global (not per-project) app settings. Just the one
 *  field for now; follows appState.ts's file-per-concern convention rather
 *  than folding into window-restore state. */
export interface Settings {
  /** Skips the "Paste N lines?" confirm (§ clipboard fix) — set via the
   *  paste-confirm overlay's own "Don't ask again" checkbox, not a
   *  separate settings screen. */
  skipMultilinePasteGuard: boolean
}
