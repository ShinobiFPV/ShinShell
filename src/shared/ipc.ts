// Shared IPC channel names + payload types, imported by both main and renderer
// (via preload) so the two sides can't drift out of sync on shape.

export const IPC = {
  ptySpawn: 'pty:spawn',
  ptyWrite: 'pty:write',
  ptyResize: 'pty:resize',
  ptyKill: 'pty:kill',
  ptyData: 'pty:data',
  ptyExit: 'pty:exit',
  sessionLoad: 'session:load',
  sessionSave: 'session:save',
  systemHomeDir: 'system:homeDir'
} as const

export interface PtySpawnOptions {
  id: string
  cwd: string
  cols: number
  rows: number
}

export interface PtyDataEvent {
  id: string
  data: string
}

export interface PtyExitEvent {
  id: string
  exitCode: number
}

export interface SessionTab {
  id: string
  cwd: string
}

export interface SessionState {
  tabs: SessionTab[]
  activeTabId: string | null
}
