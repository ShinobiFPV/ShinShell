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
  updaterCheck: 'updater:check'
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
