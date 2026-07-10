import { Menu, type WebContents } from 'electron'

// § clipboard fix — standard Cut/Copy/Paste/Select All right-click menu for
// non-terminal surfaces (Monaco, plain inputs, dialogs, the claude-chat
// WebContentsView). Deliberately generic: built fresh from each event's
// own `params`, not scoped to any one webContents beyond where it's
// attached.
//
// Terminal panes and Monaco never reach this: both already call
// `preventDefault()` on their own DOM `contextmenu` event (Terminal.tsx's
// own listener; Monaco's built-in context-menu contribution), and Blink
// only asks the browser process to show a context menu when that DOM
// event wasn't prevented — so this handler simply never fires there. No
// special-casing needed.
export function attachEditContextMenu(webContents: WebContents): void {
  webContents.on('context-menu', (_event, params) => {
    if (!params.isEditable && params.selectionText.trim().length === 0) return

    const menu = Menu.buildFromTemplate([
      { role: 'cut', enabled: params.editFlags.canCut },
      { role: 'copy', enabled: params.editFlags.canCopy },
      { role: 'paste', enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll }
    ])
    menu.popup()
  })
}
