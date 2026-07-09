import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtySpawnOptions,
  type BackgroundCommandOptions
} from '../shared/ipc'
import type { ProjectConfig, ProjectRestoreState } from '../shared/project'

const api = {
  pty: {
    spawn: (opts: PtySpawnOptions): void => ipcRenderer.send(IPC.ptySpawn, opts),
    write: (id: string, data: string): void => ipcRenderer.send(IPC.ptyWrite, id, data),
    resize: (id: string, cols: number, rows: number): void =>
      ipcRenderer.send(IPC.ptyResize, id, cols, rows),
    kill: (id: string): void => ipcRenderer.send(IPC.ptyKill, id),
    onData: (cb: (e: PtyDataEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: PtyDataEvent): void => cb(payload)
      ipcRenderer.on(IPC.ptyData, listener)
      return () => ipcRenderer.removeListener(IPC.ptyData, listener)
    },
    onExit: (cb: (e: PtyExitEvent) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: PtyExitEvent): void => cb(payload)
      ipcRenderer.on(IPC.ptyExit, listener)
      return () => ipcRenderer.removeListener(IPC.ptyExit, listener)
    }
  },
  system: {
    homeDir: (): Promise<string> => ipcRenderer.invoke(IPC.systemHomeDir),
    isElevated: (): Promise<boolean> => ipcRenderer.invoke(IPC.systemIsElevated),
    repair: (): void => ipcRenderer.send(IPC.systemRepair)
  },
  projects: {
    list: (): Promise<ProjectConfig[]> => ipcRenderer.invoke(IPC.projectsList),
    get: (id: string): Promise<ProjectConfig | undefined> => ipcRenderer.invoke(IPC.projectsGet, id),
    saveRestoreState: (id: string, restore: ProjectRestoreState): void =>
      ipcRenderer.send(IPC.projectsSaveRestoreState, id, restore),
    createFromFolder: (): Promise<ProjectConfig | null> =>
      ipcRenderer.invoke(IPC.projectsCreateFromFolder)
  },
  window: {
    openProject: (id: string): void => ipcRenderer.send(IPC.windowOpenProject, id),
    openLauncher: (): void => ipcRenderer.send(IPC.windowOpenLauncher),
    onNewTerminalTab: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.windowNewTerminalTab, listener)
      return () => ipcRenderer.removeListener(IPC.windowNewTerminalTab, listener)
    }
  },
  commands: {
    runBackground: (opts: BackgroundCommandOptions): void =>
      ipcRenderer.send(IPC.commandsRunBackground, opts)
  }
}

contextBridge.exposeInMainWorld('shinshell', api)

export type ShinShellApi = typeof api
