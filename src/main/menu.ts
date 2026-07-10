import { Menu } from 'electron'

// § clipboard fix — restores Cut/Copy/Paste/SelectAll/Undo/Redo
// accelerators (Ctrl+X/C/V/A/Z/Shift+Z) app-wide. Electron never creates
// these on its own once you go anywhere near a custom window setup, and
// this app never called Menu.setApplicationMenu() at all, so right-click
// aside, plain Ctrl+V was dead in Monaco/inputs/dialogs too. Stays
// invisible: every BrowserWindow already sets autoHideMenuBar:true
// (windows.ts) — that only hides the visible bar, not the Menu object or
// its accelerators, so this is chrome-free by construction.
//
// Deliberately minimal — just the Edit role, nothing else. Terminal panes
// neutralize these same accelerators themselves (Terminal.tsx's
// attachCustomKeyEventHandler) so a readline/PSReadLine binding like
// Ctrl+A or Ctrl+Z inside a shell prompt is never swallowed by this menu.
export function installApplicationMenu(): void {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }]))
}
