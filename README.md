# ShinShell

A single, always-elevated Windows desktop app that consolidates William Kew's dev pipeline
(ShinTech Electronics) into one tabbed, multi-window workspace — PowerShell terminals, Claude
chat, an editor/scratchpad, and one-keystroke deploys, across `imq2`, `shinlink-os`, and
`AC1Companion`. See `SHINSHELL_SPEC.md` for the full brief and `docs/DISCOVERY.md` for the Phase 0
findings and per-milestone verification notes this build is based on.

## Install

1. Build the installer (or grab the latest one from a release, once those exist):
   ```powershell
   npm install
   npm run release
   ```
   This produces an NSIS installer under `dist/`.
2. Run the installer. It's a **per-machine** install (writes to Program Files, needs one UAC
   prompt to run the installer itself — that's normal and separate from ShinShell's own
   no-prompt-launch behavior described below). It:
   - Copies the app to `C:\Program Files\ShinShell\`.
   - Registers a Windows **Scheduled Task** named `ShinShell` (`RunLevel=Highest`,
     `LogonType=Interactive`, running as the installing user).
   - Creates a Desktop shortcut and a Start Menu shortcut (`ShinShell` folder), both pointing at
     `schtasks.exe /run /tn ShinShell` rather than the exe directly.
3. Launch ShinShell from either shortcut. First launch seeds the three project configs
   (`imq2`, `shinlink-os`, `ac1companion`) into `%APPDATA%\ShinShell\projects\` from
   `resources\default-projects\` and opens the launcher window.

Uninstalling (via "Add or remove programs") removes the scheduled task and both shortcuts along
with the app itself. Your project configs, session state, scratchpads, and deploy/watch-sync
history under `%APPDATA%\ShinShell\` are **not** deleted by uninstall, so reinstalling picks up
where you left off.

## Elevation model

ShinShell runs **elevated (Administrator)** at all times, with **no UAC prompt on normal
launches**. This works via the Scheduled Task from install, not the executable's own manifest:

- Task Scheduler is allowed to launch a task with `RunLevel=Highest` at high integrity without
  showing the interactive UAC consent dialog — that's what the Desktop/Start Menu shortcuts invoke
  (`schtasks /run /tn ShinShell`), instead of launching `ShinShell.exe` directly.
- The executable's own manifest is `asInvoker` (see `package.json`'s `build.win`) — a direct
  double-click of the exe (bypassing the shortcut, e.g. from `C:\Program Files\ShinShell\` in
  Explorer) launches **unelevated**. This is intentional: it's what lets the app detect "I'm not
  elevated" and offer to fix itself, rather than forcing a UAC prompt on every possible launch path.
- Elevation state is always visible via the **ADMIN badge** (top-right of every window). If it's
  not elevated — e.g. the scheduled task is missing because the app moved machines, was reinstalled
  outside the installer, or was launched directly instead of via the shortcut — the badge becomes a
  **Repair** button. Clicking it triggers one UAC prompt, re-registers the scheduled task, and
  relaunches; every launch after that is prompt-free again via the (now-working) shortcut.
- If the app is *already* running elevated for any reason but the scheduled task is missing or
  broken, it repairs the task silently in the background on startup — no prompt needed, since it
  already has the rights to do so.

### Manually repairing the scheduled task

If the in-app Repair button isn't available (e.g. the app won't launch at all) or you want to
inspect/fix things by hand, open an **elevated** PowerShell and run:

```powershell
# Check whether the task exists and is configured correctly:
Get-ScheduledTask -TaskName ShinShell | Select-Object TaskName, State
Get-ScheduledTask -TaskName ShinShell | Select-Object -ExpandProperty Principal   # expect RunLevel=Highest, LogonType=Interactive

# Remove a broken task:
Unregister-ScheduledTask -TaskName ShinShell -Confirm:$false

# Re-register it (same logic the installer/repair flow runs), pointing at wherever the exe actually is:
$action = New-ScheduledTaskAction -Execute "C:\Program Files\ShinShell\ShinShell.exe"
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest -LogonType Interactive
Register-ScheduledTask -TaskName "ShinShell" -Action $action -Principal $principal -Force

# Launch it manually to confirm (should open with no UAC prompt):
schtasks /run /tn ShinShell
```

If the Desktop/Start Menu shortcuts themselves went missing (task exists but nothing launches it),
recreate them pointing at `schtasks.exe` with argument `/run /tn ShinShell` — **not** at the
ShinShell exe directly, or you'll get a UAC prompt every time instead of none.

### Tradeoff: UIPI blocks drag-and-drop from non-elevated windows

Because ShinShell runs elevated, **Windows' UIPI (User Interface Privilege Isolation) blocks
drag-and-drop from non-elevated windows** — e.g. dragging a file from a normal (non-admin)
Explorer window into ShinShell won't work; Windows silently drops the input. This applies to
everything in the app running at that privilege level, including the embedded Claude chat browser
tab and Claude Code terminal sessions.

The workaround, everywhere ShinShell needs a file/folder from the user, is an explicit **"Open
File" / "Open Folder" dialog** (`dialog.showOpenDialog`) rather than drag-and-drop — this is how
project creation works in the launcher (`+ Open Project`) and how editor tabs open/save files.

## Usage

### Windows and tabs

- The **launcher** window shows recent projects plus **+ Open Project** (folder picker) to add a
  new one. Opening a project (or the pre-registered `imq2` / `shinlink-os` / `ac1companion`) opens
  its own `BrowserWindow`, tinted with that project's accent color in the tab strip.
- Each project window's tab strip has one button per tab kind: **+Term** (PowerShell terminal),
  **+CC** (terminal pre-seeded with `claude`), **+Chat** (embedded claude.ai, signed in once via
  a shared session across every project window), **+Edit** (Monaco editor, Open/Save dialogs),
  **+Pad** (a singleton per-project scratchpad, auto-saved, no manual save needed), **+Log**
  (tail one of the project's saved commands — picker lists them all), **Deploy** (one button per
  `deploy*` command plus run history and, if configured, the watch-and-sync toggle), and **Ports**
  (live TCP/UDP listeners on this machine, with kill support and highlighting for the project's own
  configured ports).
- Session state (open tabs, cwd, active tab, which project windows were open) persists across
  restarts automatically — no manual save step.
- Splits: `Ctrl+\` (vertical) / `Ctrl+Shift+\` (horizontal) split the active terminal pane.

### Command palette

`Ctrl+Shift+P` opens a fuzzy-searchable palette over every project command, every tab-creation
action, and every other open project (to switch to it). Type to filter; arrow keys or mouse to
select; Enter or click to run. Commands with no bound hotkey (e.g. `publish-shinagent`,
`publish-public` — deliberately unbound so a rarely-used public-export action can't be
fat-fingered) are only reachable this way.

### Hotkeys

Global (work from any ShinShell window):

| Key | Action |
|---|---|
| `` Ctrl+` `` | Summon/hide the last-focused ShinShell window |
| `Ctrl+Alt+1`…`9` | Jump to the Nth open project window |
| `Ctrl+Alt+T` | New terminal tab in the last-focused project |
| `Ctrl+Shift+P` | Open the command palette |

Project-scoped (read from each project's own config, so the table below is the current default —
check a project's `commands` in its config or the palette for the authoritative list):

| Key | imq2 | shinlink-os | AC1Companion |
|---|---|---|---|
| `Ctrl+1` | Deploy to Pi | Deploy to Pi | Start dev server |
| `Ctrl+Shift+1` | Deploy + restart Q2 | Deploy (dry run) | *(unused)* |
| `Ctrl+2` | Tail Q2 logs | Tail ground station log | Deploy backend to Pi |
| `Ctrl+3` | Q2 status (tmux) | *(unused)* | Tail ac-companion log |
| `Ctrl+4` | Restart Q2 (tmux) | *(unused)* | *(unused)* |
| `Ctrl+5` | Attach Q2 tmux | *(unused)* | *(unused)* |

### Deploy tab & watch-and-sync

The Deploy tab runs any of the project's `deploy*`-prefixed commands as a one-shot process (not an
interactive shell), so its exit code is the real command's exit code, and keeps the last 20 runs
(exit code, duration, timestamp) in `%APPDATA%\ShinShell\deploy-history\<project>.json`.

If a project's config has a `watchSync` block with `globs`/`onChange` set, the Deploy tab also
shows a **Watch & sync** checkbox. Enabling it starts a file watcher (debounced) over the
configured globs that automatically re-runs the `onChange` command on every matching file save —
useful for a tight edit/deploy loop, but it's **off by default per project** and stays off across
restarts until you turn it on, since it means every save to a matching file triggers a real deploy.
Activity (which file changed, whether the resulting run succeeded, when) is shown live in the same
tab and persisted to `%APPDATA%\ShinShell\watch-activity\<project>.json`.

### Ports panel

Lists live TCP/UDP listeners on this machine (via `Get-NetTCPConnection`/`Get-NetUDPEndpoint`) with
owning process name and PID. Rows matching one of the project's configured `ports` are highlighted.
Killing a process asks for confirmation first — it's a real, destructive `taskkill /F`.

### Git status

Each project window's tab strip shows the current branch and a clean/dirty dot for that project's
`workingDir`, polled every 30s. Not shown for a folder that isn't a git repo.

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

Project configs live as plain JSON at `%APPDATA%\ShinShell\projects\<id>.json` (schema in
`src/shared/project.ts`, defaults seeded from `resources\default-projects\`) — they're meant to be
hand-edited directly for anything not yet exposed in a settings UI, since none exists yet.
