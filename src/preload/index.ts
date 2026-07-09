import { contextBridge, ipcRenderer } from 'electron'
import { IPC, type PtyDataEvent, type PtyExitEvent, type PtySpawnOptions, type SessionState } from '../shared/ipc'

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
  session: {
    load: (): Promise<SessionState> => ipcRenderer.invoke(IPC.sessionLoad),
    save: (state: SessionState): void => ipcRenderer.send(IPC.sessionSave, state)
  },
  system: {
    homeDir: (): Promise<string> => ipcRenderer.invoke(IPC.systemHomeDir)
  }
}

contextBridge.exposeInMainWorld('shinshell', api)

export type ShinShellApi = typeof api
