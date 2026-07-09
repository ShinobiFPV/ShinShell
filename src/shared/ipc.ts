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
  windowOpenProject: 'window:openProject',
  windowOpenLauncher: 'window:openLauncher',
  windowNewTerminalTab: 'window:newTerminalTab',
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
  scratchpadLoad: 'scratchpad:load',
  scratchpadSave: 'scratchpad:save'
} as const

export interface PtySpawnOptions {
  id: string
  cwd: string
  cols: number
  rows: number
  shell?: string
  env?: Record<string, string>
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
