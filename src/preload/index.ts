import { contextBridge, ipcRenderer } from 'electron'
import {
  IPC,
  type PtyDataEvent,
  type PtyExitEvent,
  type PtySpawnOptions,
  type BackgroundCommandOptions,
  type ViewBounds,
  type ClaudeChatNavState,
  type DeployRun,
  type SshHealthStatus,
  type PortEntry,
  type GitStatus,
  type WatchSyncActivityEntry
} from '../shared/ipc'
import type {
  ProjectConfig,
  ProjectRestoreState,
  ProjectValidation,
  PathCandidate,
  ProjectUpdatePayload
} from '../shared/project'

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
      ipcRenderer.invoke(IPC.projectsCreateFromFolder),
    validate: (id: string): Promise<ProjectValidation> => ipcRenderer.invoke(IPC.projectsValidate, id),
    suggestFixes: (id: string): Promise<PathCandidate[]> => ipcRenderer.invoke(IPC.projectsSuggestFixes, id),
    update: (payload: ProjectUpdatePayload): Promise<ProjectConfig> =>
      ipcRenderer.invoke(IPC.projectsUpdate, payload),
    onUpdated: (cb: (config: ProjectConfig) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ProjectConfig): void => cb(payload)
      ipcRenderer.on(IPC.projectsUpdated, listener)
      return () => ipcRenderer.removeListener(IPC.projectsUpdated, listener)
    }
  },
  window: {
    openProject: (id: string): void => ipcRenderer.send(IPC.windowOpenProject, id),
    openLauncher: (): void => ipcRenderer.send(IPC.windowOpenLauncher),
    onNewTerminalTab: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.windowNewTerminalTab, listener)
      return () => ipcRenderer.removeListener(IPC.windowNewTerminalTab, listener)
    },
    setProgress: (progress: number | null): void => ipcRenderer.send(IPC.windowSetProgress, progress),
    flash: (): void => ipcRenderer.send(IPC.windowFlash),
    // Fired when this window moves (possibly to a different monitor) or any
    // display's scale factor changes — the signal to re-fit/redraw terminals
    // since a DPI change doesn't touch container CSS size (see
    // terminalRegistry.ts).
    onDisplayChanged: (cb: () => void): (() => void) => {
      const listener = (): void => cb()
      ipcRenderer.on(IPC.windowDisplayChanged, listener)
      return () => ipcRenderer.removeListener(IPC.windowDisplayChanged, listener)
    }
  },
  commands: {
    runBackground: (opts: BackgroundCommandOptions): void =>
      ipcRenderer.send(IPC.commandsRunBackground, opts)
  },
  claudeChat: {
    create: (id: string): void => ipcRenderer.send(IPC.claudeChatCreate, id),
    setBounds: (id: string, bounds: ViewBounds): void =>
      ipcRenderer.send(IPC.claudeChatSetBounds, id, bounds),
    setVisible: (id: string, visible: boolean): void =>
      ipcRenderer.send(IPC.claudeChatSetVisible, id, visible),
    back: (id: string): void => ipcRenderer.send(IPC.claudeChatBack, id),
    forward: (id: string): void => ipcRenderer.send(IPC.claudeChatForward, id),
    reload: (id: string): void => ipcRenderer.send(IPC.claudeChatReload, id),
    destroy: (id: string): void => ipcRenderer.send(IPC.claudeChatDestroy, id),
    onNavState: (cb: (e: ClaudeChatNavState) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ClaudeChatNavState): void => cb(payload)
      ipcRenderer.on(IPC.claudeChatNavState, listener)
      return () => ipcRenderer.removeListener(IPC.claudeChatNavState, listener)
    }
  },
  files: {
    read: (path: string): Promise<string> => ipcRenderer.invoke(IPC.filesRead, path),
    write: (path: string, content: string): void => ipcRenderer.send(IPC.filesWrite, path, content),
    showOpenDialog: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.filesShowOpenDialog, defaultPath),
    showSaveDialog: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.filesShowSaveDialog, defaultPath),
    showOpenFolderDialog: (defaultPath?: string): Promise<string | null> =>
      ipcRenderer.invoke(IPC.filesShowOpenFolderDialog, defaultPath),
    pathIsDirectory: (path: string): Promise<boolean> => ipcRenderer.invoke(IPC.filesPathIsDirectory, path)
  },
  scratchpad: {
    load: (projectId: string): Promise<string> => ipcRenderer.invoke(IPC.scratchpadLoad, projectId),
    save: (projectId: string, content: string): void =>
      ipcRenderer.send(IPC.scratchpadSave, projectId, content)
  },
  deployHistory: {
    get: (projectId: string): Promise<DeployRun[]> => ipcRenderer.invoke(IPC.deployHistoryGet, projectId),
    append: (projectId: string, run: DeployRun): void =>
      ipcRenderer.send(IPC.deployHistoryAppend, projectId, run)
  },
  sshHealth: {
    subscribe: (projectId: string): void => ipcRenderer.send(IPC.sshHealthSubscribe, projectId),
    unsubscribe: (projectId: string): void => ipcRenderer.send(IPC.sshHealthUnsubscribe, projectId),
    onStatus: (cb: (e: SshHealthStatus) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SshHealthStatus): void => cb(payload)
      ipcRenderer.on(IPC.sshHealthStatus, listener)
      return () => ipcRenderer.removeListener(IPC.sshHealthStatus, listener)
    }
  },
  ports: {
    list: (): Promise<PortEntry[]> => ipcRenderer.invoke(IPC.portsList),
    kill: (pid: number): void => ipcRenderer.send(IPC.portsKill, pid)
  },
  gitStatus: {
    get: (workingDir: string): Promise<GitStatus | null> => ipcRenderer.invoke(IPC.gitStatusGet, workingDir)
  },
  watchSync: {
    setEnabled: (projectId: string, enabled: boolean): void =>
      ipcRenderer.send(IPC.watchSyncSetEnabled, projectId, enabled),
    getActivity: (projectId: string): Promise<WatchSyncActivityEntry[]> =>
      ipcRenderer.invoke(IPC.watchSyncGetActivity, projectId),
    onActivity: (cb: (e: WatchSyncActivityEntry) => void): (() => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: WatchSyncActivityEntry): void => cb(payload)
      ipcRenderer.on(IPC.watchSyncActivity, listener)
      return () => ipcRenderer.removeListener(IPC.watchSyncActivity, listener)
    }
  },
  updater: {
    // The whole flow (dialog, download progress, quitAndInstall) lives in
    // main/updater.ts — this just triggers a check the same way the
    // 10s-after-launch automatic one does, but interactively (so a
    // no-update-found or error state gets a dialog instead of staying silent).
    check: (): void => ipcRenderer.send(IPC.updaterCheck)
  }
}

contextBridge.exposeInMainWorld('shinshell', api)

export type ShinShellApi = typeof api
