# ShinShell — Project Specification & Build Brief

**Working title:** ShinShell (rename freely)
**Client:** "shinobi" / ShinTech Electronics
**Dev machine:** Windows 11 Pro
**This document is the authoritative brief for Claude Code. Read it fully before writing any code. Do NOT skip Phase 0.**

---

## 1. Vision

A single, always-elevated Windows desktop app that consolidates an entire dev
pipeline into one tabbed, multi-window workspace:

- **PowerShell terminals** (real pwsh, Oh-My-Posh intact) — multiple per project
- **Claude chat** (embedded claude.ai browser tab)
- **Editor/scratchpad** (Monaco)
- **One-keystroke deploys** to remote targets (Raspberry Pi 5 "shinobi" and others)

Each open **project lives in its own color-coded window** with its own tab set.
The app launches from the desktop/taskbar **with zero UAC prompts** and every
terminal it spawns is already Administrator.

Primary use case: developing on Windows with Claude Code and constantly
pushing code over SSH to a Pi 5 (hostname `shinobi`, at 192.168.1.203) and
other devices (Pi Zero 2W units, an original Pi 1 "ShinPod" at 192.168.1.183).
The app should make that loop nearly frictionless.

---

## 2. Phase 0 — Discovery (DO THIS FIRST, BEFORE ANY CODE)

This spec was written before inspecting the existing projects. Your first job is
to **scope the real requirements from the codebases sitting next to this one.**

This project folder is intended to live as a sibling of the other projects under
the shared dev root. You should have been launched with access to those siblings
(via `--add-dir` or by starting from the dev root). If you cannot see sibling
project directories, STOP and ask to be relaunched with access before proceeding.

### 2.1 Inventory the sibling projects

Scan sibling directories for (read-only — do not modify them):

1. **Deploy mechanics** — Find every deploy/sync script (PowerShell deploy scripts,
   rsync/scp/ssh invocations, `tools/publish_shinagent.sh`-style pipelines).
   Record: exact command lines, source→target path mappings, SSH hosts/users/ports,
   any pre/post steps (service restarts, `systemctl`, pip installs).
2. **Remote targets** — Every host/IP/user that appears in scripts or configs
   (expect at minimum: shinobi/192.168.1.203, possibly Pi Zero units, ShinPod).
3. **Run/debug commands** — How each project is started locally and remotely
   (FastAPI/uvicorn invocations, Electron dev servers, Python entry points,
   systemd unit names, tkinter apps, `ac_bridge.py`, Flask bridges, etc.).
4. **Ports in active use** — Known so far: UDP 8000/8001 (telemetry), 8095
   (ShinLink bridge). Find the rest. These feed the port-manager feature (§6.8).
5. **Existing CLAUDE.md files** — Note conventions already in use with
   Claude Code per project.
6. **Log locations** — journald unit names, log files, or stdout patterns per
   project, for the log-tail feature (§6.6).

### 2.2 Produce a requirements addendum

Write `docs/DISCOVERY.md` in THIS project containing:

- A table of projects → deploy command(s) → target host(s) → run command(s) → ports
- A proposed set of **default project configs** (§7 schema) pre-filled from findings
- A proposed set of **default hotkey commands** per project (§8)
- Open questions for the project owner

### 2.3 Interview the project owner

Before Milestone 1, confirm:

- Dev root path and which projects to pre-register
- Preferred accent color per project
- Actual most-typed commands (validate the extraction)
- PowerShell 7 path (`pwsh.exe`) and Oh-My-Posh theme/profile location
- Whether Claude sign-in is via Google (affects §6.3 user-agent handling)

Only then start building.

---

## 3. Architecture

| Layer | Choice | Rationale |
|---|---|---|
| Shell | **Electron + React + TypeScript** | Matches the existing stack (AC server manager); fastest path |
| Terminal | **xterm.js + node-pty** | Same combo as VS Code; ConPTY → real pwsh → Oh-My-Posh renders natively |
| Browser tab | **WebContentsView** | Embedded claude.ai with persistent session partition |
| Editor | **Monaco** | Full VS Code editor component; replaces "notepad" requirement outright |
| File watch | **chokidar** | Auto-sync mode |
| Config | JSON files in `%APPDATA%/ShinShell/` | Human-editable; projects are portable |
| Elevation | **Scheduled Task launch** (§5) | Persistent admin, zero UAC prompts |

Build tooling: electron-builder (NSIS installer), electron-vite. Keep
main/renderer separation clean; all pty and fs work in the main process, IPC
via typed channels.

**Node-pty notes:** use PowerShell 7 (`pwsh.exe`) as default shell, spawn with
the user's normal profile so Oh-My-Posh/PSReadLine load unchanged. Handle
resize events (fit addon), and use xterm.js WebGL renderer for performance.

---

## 4. Multi-window / multi-project model

- One **OS window per open project**. Each window: title bar + tab strip tinted
  with the project's accent color, project name in title.
- Taskbar: `setOverlayIcon` with a colored dot matching the accent so windows
  are distinguishable when alt-tabbing.
- A lightweight **launcher/home window** on first open: recent projects grid,
  "open project" (pick a folder), global settings.
- Tab types within a project window: `terminal`, `claude-code` (terminal preset
  that runs `claude` in the project dir), `claude-chat` (browser), `editor`,
  `scratchpad`, `log-tail`, `deploy`.
- Full session restore: reopening the app restores windows, tabs, working
  directories (terminal scrollback restore is NOT required).

---

## 5. Elevation strategy (persistent admin, no prompts)

1. Installer (running elevated once) registers a Windows Scheduled Task
   `ShinShell` — "Run with highest privileges," trigger: on demand, action:
   launch the app exe.
2. The desktop/taskbar shortcut points to a tiny launcher (or
   `schtasks /run /tn "ShinShell"`) so every launch is elevated with **no UAC
   dialog**.
3. Fallback: if the task is missing (e.g., moved machines), app detects
   non-elevated state, offers to self-repair (relaunch elevated once, recreate
   task).
4. Show a subtle "ADMIN" badge in the UI so elevation state is always visible.
5. Document the tradeoff in README: everything (including the embedded browser
   and Claude Code sessions) runs elevated; drag-and-drop from non-elevated
   Explorer into the app will be blocked by Windows (UIPI) — provide an
   "open file" dialog as the alternative.

---

## 6. Feature requirements

### P0 — must ship

1. **6.1 Terminals:** unlimited pwsh tabs per project, opened in the project's
   working directory, Oh-My-Posh fully functional, copy/paste, search,
   configurable font/size, split panes (horizontal/vertical) within a tab.
2. **6.2 Project windows:** color-coded per §4, project config per §7,
   create/edit projects in-app.
3. **6.3 Claude chat tab:** claude.ai in a WebContentsView with a persistent
   session partition. Set a standard Chrome user-agent string so Google OAuth
   sign-in works. Back/forward/reload controls. External links open in default
   browser.
4. **6.4 Editor + scratchpad:** Monaco editor tab with open/save into the
   project tree; per-project auto-saved markdown scratchpad tab.
5. **6.5 Hotkey command system:** per §8.
6. **Elevation:** per §5.
7. **Session restore** per §4.

### P1 — should ship

6. **6.6 Log-tail tab:** preset that opens an SSH connection and tails a
   configured remote command (e.g., `journalctl -fu <unit> -o cat` on shinobi).
   Reconnect button; connection state indicator.
7. **6.7 Deploy tab + SSH health:** per-project deploy button running the
   configured deploy command with streamed output; a status light in the tab
   strip polling the project's primary SSH target (TCP connect to port 22
   every ~15s). Deploy history (last 20 runs, exit codes, durations).
8. **6.8 Port/process panel:** list listening ports (netstat/Get-NetTCPConnection),
   filterable, with per-row kill (taskkill /PID). Highlight ports named in
   project configs.
9. **6.9 Global summon:** a global hotkey (default Ctrl+`) toggling show/hide
   of the most recent project window, quake-style.

### P2 — nice to have (build only after P0/P1 are solid)

10. **6.10 Watch-and-sync mode:** chokidar on configured globs → run the sync
    command on change, debounced; toggle in the deploy tab; activity log.
11. **6.11 Command palette:** Ctrl+Shift+P fuzzy palette over all saved
    commands, tab actions, and project switching.
12. **6.12 Git status in tab strip:** branch name + dirty indicator per project.
13. **6.13 Theming:** dark default; ShinTech/H9000 Terminal aesthetic is
    encouraged (the house brand — see the IMQ2 manual styling for reference)
    but keep it readable and fast.

Explicit non-goals for v1: SSH terminal multiplexing UI (just spawn `ssh` in a
pty), plugin system, macOS/Linux builds, tray-only mode, settings sync.

---

## 7. Project config schema

One JSON per project in `%APPDATA%/ShinShell/projects/`:

```jsonc
{
  "id": "imq2",
  "name": "IMQ2 / Q2",
  "accentColor": "#FF6B35",
  "workingDir": "C:/Dev/imq2",            // confirm real path in Phase 0
  "shell": "pwsh.exe",
  "env": {},                               // extra env vars for terminals
  "targets": [
    {
      "id": "shinobi",
      "label": "Pi 5 (shinobi)",
      "host": "192.168.1.203",
      "user": "<your-username>",
      "port": 22,
      "healthCheck": true
    }
  ],
  "commands": [
    {
      "id": "deploy",
      "label": "Deploy to Pi",
      "command": "./deploy.ps1",           // fill from Phase 0 discovery
      "hotkey": "Ctrl+1",
      "runIn": "new-tab"                    // new-tab | active-terminal | background
    },
    {
      "id": "logs",
      "label": "Tail Q2 logs",
      "command": "ssh {targets.shinobi.user}@{targets.shinobi.host} journalctl -fu q2 -o cat",
      "hotkey": "Ctrl+2",
      "runIn": "new-tab"
    }
  ],
  "watchSync": {
    "enabled": false,
    "globs": ["**/*.py"],
    "ignore": ["**/__pycache__/**", "**/.git/**"],
    "onChange": "deploy",                   // command id
    "debounceMs": 1500
  },
  "ports": [8000, 8001, 8095],
  "restore": { "tabs": [] }                 // managed by the app
}
```

Support `{targets.<id>.<field>}`, `{workingDir}`, and `{env.<NAME>}` variable
substitution in command strings.

---

## 8. Hotkey system

Two scopes:

- **Global (OS-wide, Electron globalShortcut):** summon/hide (Ctrl+`),
  jump-to-project (configurable, e.g. Ctrl+Alt+1..9), new terminal in active
  project (Ctrl+Alt+T).
- **Project-scoped (active window):** Ctrl+1..9 mapped to the project's saved
  commands (§7). Same physical key does different things per project — this is
  the core of the feature. Ctrl+T new terminal tab, Ctrl+W close tab,
  Ctrl+Tab cycle tabs.

All bindings editable in settings with conflict detection. Saved commands can
inject into the active terminal (typed but not executed — leave cursor at end)
OR execute in a new tab, per the command's `runIn`.

---

## 9. Milestones

Build and verify in this order; each milestone should run end-to-end before
starting the next. Commit per milestone.

- **M0 — Discovery:** §2 complete, `docs/DISCOVERY.md` written, signed off.
- **M1 — Terminal core:** Electron shell, one window, xterm.js + node-pty tabs,
  Oh-My-Posh confirmed rendering correctly, splits, session restore for terminals.
- **M2 — Projects & windows:** config schema, launcher window, per-project
  windows, accent colors, taskbar overlay dots.
- **M3 — Elevation & packaging:** NSIS installer, scheduled-task registration,
  taskbar shortcut, zero-prompt elevated launch verified, ADMIN badge.
- **M4 — Commands & hotkeys:** §7 commands + §8 bindings, variable substitution.
- **M5 — Claude & editor tabs:** claude-chat WebContentsView (Google OAuth
  verified), claude-code tab preset, Monaco editor + scratchpad.
- **M6 — Pipeline features:** deploy tab, SSH health, log-tail, port panel.
- **M7 — Polish:** watch-and-sync, command palette, git status, theming pass,
  README with install + scheduled-task repair instructions.

---

## 10. Acceptance criteria (spot-check list)

- [ ] Launch from taskbar → elevated window in <3s, **no UAC prompt**
- [ ] `whoami /groups` in a new terminal shows elevated; Oh-My-Posh prompt renders identically to standalone pwsh
- [ ] Two projects open = two windows, visibly different accent colors, distinguishable in taskbar
- [ ] Ctrl+1 in the IMQ2 window fires the Pi deploy; Ctrl+1 in another project fires that project's command
- [ ] Claude.ai tab: signed in, session survives app restart
- [ ] Kill the app mid-session → relaunch restores all windows/tabs/working dirs
- [ ] SSH light turns red within ~30s of the Pi going offline
- [ ] Everything works with the machine offline except the Claude tab and remote features

## 11. Working agreements for Claude Code

- Ask before adding dependencies beyond those named in §3.
- Never modify sibling project directories; they are reference-only.
- Keep secrets out of the repo; SSH relies on the user's existing key setup
  (keys already deployed to shinobi) — do not implement password storage.
- Windows is the only target; don't spend effort on cross-platform abstractions.
- When uncertain about a workflow detail, check the sibling projects first,
  then ask before proceeding.
