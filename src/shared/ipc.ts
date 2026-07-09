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
  projectsList: 'projects:list',
  projectsGet: 'projects:get',
  projectsSaveRestoreState: 'projects:saveRestoreState',
  projectsCreateFromFolder: 'projects:createFromFolder',
  windowOpenProject: 'window:openProject',
  windowOpenLauncher: 'window:openLauncher'
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
