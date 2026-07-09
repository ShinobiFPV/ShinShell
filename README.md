# ShinShell

A single, always-elevated Windows desktop app that consolidates William Kew's dev pipeline
(ShinTech Electronics) into one tabbed, multi-window workspace — PowerShell terminals, Claude
chat, an editor/scratchpad, and one-keystroke deploys. See `SHINSHELL_SPEC.md` for the full brief
and `docs/DISCOVERY.md` for the Phase 0 findings this build is based on.

This README currently covers the elevation model (§5 of the spec); a full install/usage guide is
an M7 polish item.

## Elevation model

ShinShell runs **elevated (Administrator)** at all times, with **no UAC prompt on normal
launches**. This works via a Windows Scheduled Task, not the executable's own manifest:

- The installer registers a Scheduled Task named `ShinShell` with `RunLevel=Highest` and
  `LogonType=Interactive`. Task Scheduler is allowed to launch a task like this at high integrity
  without showing the interactive UAC consent dialog.
- The desktop and Start Menu shortcuts the installer creates point at
  `schtasks.exe /run /tn ShinShell`, **not** directly at `ShinShell.exe`. That's what gets you the
  no-prompt launch.
- The executable's own manifest is `asInvoker` (see `package.json`'s `build.win`) — a direct
  double-click of the exe (bypassing the shortcut) launches **unelevated**. This is intentional:
  it's what lets the app detect "I'm not elevated" and offer to fix itself, rather than forcing a
  UAC prompt on every possible launch path.
- Elevation state is always visible via the **ADMIN badge** (top-right of every window). If it's
  not elevated — e.g. the scheduled task is missing because the app moved machines, or was
  launched directly instead of via the shortcut — the badge becomes a **Repair** button. Clicking
  it triggers one UAC prompt, re-registers the scheduled task, and relaunches; every launch after
  that is prompt-free again via the (now-working) shortcut.
- If the app is *already* running elevated for any reason but the scheduled task is missing or
  broken, it repairs the task silently in the background on startup — no prompt needed, since it
  already has the rights to do so.

### Tradeoff: UIPI blocks drag-and-drop from non-elevated windows

Because ShinShell runs elevated, **Windows' UIPI (User Interface Privilege Isolation) blocks
drag-and-drop from non-elevated windows** — e.g. dragging a file from a normal (non-admin)
Explorer window into ShinShell won't work; Windows silently drops the input. This applies to
everything in the app running at that privilege level, including the embedded Claude chat browser
tab and Claude Code terminal sessions once those land (M5).

The workaround, everywhere ShinShell needs a file/folder from the user, is an explicit **"Open
File" / "Open Folder" dialog** (`dialog.showOpenDialog`) rather than drag-and-drop — this is
already how project creation works in the launcher (`+ Open Project`).

## Development

```powershell
npm install
npm run dev      # electron-vite dev server + Electron, hot reload
npm run build    # production build to out/
npm run pack     # build + electron-builder --dir (unpacked, for quick local testing)
npm run release  # build + electron-builder (produces the NSIS installer)
```

Requires PowerShell 5.1+ (this dev machine doesn't have PowerShell 7 installed — see
`docs/DISCOVERY.md` §5.5) and, for `node-pty`'s native module, Visual Studio Build Tools with the
C++ workload (see `docs/DISCOVERY.md` §5a for the exact machine-specific gotchas hit getting that
working).
