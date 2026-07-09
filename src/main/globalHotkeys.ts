import { globalShortcut } from 'electron'
import { IPC } from '../shared/ipc'
import { openProjectWindow, getProjectIdByIndex, getLastFocusedProjectWindow, toggleSummon } from './windows'

// Global (OS-wide) bindings — spec §8. Project-scoped bindings (Ctrl+1..9,
// Ctrl+T/W/Tab, per-command hotkeys) are handled in the renderer since
// they're specific to whichever project window has focus.
export function registerGlobalHotkeys(): void {
  globalShortcut.register('Control+`', () => toggleSummon())

  for (let i = 1; i <= 9; i++) {
    globalShortcut.register(`Control+Alt+${i}`, () => {
      const id = getProjectIdByIndex(i)
      if (id) openProjectWindow(id)
    })
  }

  globalShortcut.register('Control+Alt+T', () => {
    getLastFocusedProjectWindow()?.webContents.send(IPC.windowNewTerminalTab)
  })
}

export function unregisterGlobalHotkeys(): void {
  globalShortcut.unregisterAll()
}
