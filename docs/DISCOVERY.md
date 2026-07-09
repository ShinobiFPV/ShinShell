# ShinShell — Phase 0 Discovery

Read-only inventory of `imq2`, `shinlink-os`, and `AC1Companion` (siblings under
`C:\Users\billk\Projects\ShinTech\`), performed per SHINSHELL_SPEC.md §2. No sibling repo's working
tree was modified during discovery itself; two small follow-up commits in `shinlink-os` were
separately approved by William and are tracked in §5. All paths/commands below are quoted from the
actual files, not paraphrased from the spec's assumptions — several of the spec's placeholder
assumptions turned out to be wrong or incomplete (noted inline).

**Status: RESOLVED 2026-07-09 — William signed off, proceeding to M1.**

---

## 1. Summary table

| | **imq2** | **shinlink-os** | **AC1Companion** |
|---|---|---|---|
| **Deploy command** | `.\deploy.ps1 [-restart] [-dryrun]` (scp/ssh) | `.\deploy.ps1 [-dryrun]` (scp/ssh) | `.\scripts\deploy-backend.ps1` (scp/ssh + `systemctl restart`) |
| **Target host** | alias `shinobi` → `192.168.1.203`, user `shinobi` (confirmed in `~/.ssh/config`, see §5) | `192.168.1.203` hardcoded, user `shinobi` — **being patched to use the `shinobi` alias, §5** | `192.168.1.203` hardcoded, user `shinobi` |
| **Deploy target path** | `/home/shinobi/imq2/` | `/home/shinobi/` (flat, `ground/*.py`) + `/home/shinobi/shinlink_{beacon,firmware,mobile,lua,assets,docs,archive}/` | `/home/shinobi/ac-companion-backend/` |
| **Run (remote)** | `bash scripts/q2_start.sh` → tmux session `q2`; **no systemd unit** | `cd /home/shinobi && python3 shinlink_os.py` — manual GUI on the Pi's attached display + GPIO, **never launched remotely** | `systemctl restart ac-companion` — **real systemd service**, unlike the other two |
| **Run (local dev)** | `python main.py [--text\|--face\|--webapp]` | `python3 ground/shinlink_os.py` | `.\scripts\dev.ps1` (vite + electron, `npm run dev`) |
| **Logs** | `logs/imq2.log`; helpers `scripts/q2_log.sh`, `q2_status.sh`, `q2_attach.sh` | `shinlink_os.log` (CWD-relative → `/home/shinobi/shinlink_os.log`) | journald unit `ac-companion` → `journalctl -u ac-companion -f` works natively |
| **Ports (own)** | UDP 8000–8003 (telemetry), HTTP 8091/8092 (Windows-PC side), 8095 (shinlink bridge client), 8765–8767 | HTTP 8095 (agent bridge, 127.0.0.1 only), UDP 5760/5761, 3232, 8080, 14550, 8554/8889/8888/5000, 10110/**8010**\*/30003 | HTTP 3000 (backend + `/api/health`) |
| **CLAUDE.md** | `imq2/CLAUDE.md` | `shinlink-os/CLAUDE.md` | `AC1Companion/CLAUDE.md` |
| **Public export script** | `tools/publish_shinagent.sh` → `ShinobiFPV/shinagent` | — | `scripts/publish-public.ps1` → `ShinobiFPV/ac-server-manager` |

\* shinlink-os's Watchtower APRS/Direwolf port is being moved from **8000 → 8010** (§5) to resolve a collision with imq2's Forza telemetry port, both of which listen on the same host (shinobi).

**Cross-project link confirmed:** `imq2/config/config.yaml`'s `integrations.shinlink_os.config_path` (`/home/shinobi/config.json`) correctly points at where `shinlink-os`'s `config.json` lands once deployed. In practice this key is now **vestigial** — the live code path is `imq2/integrations/shinlink_bridge.py`, an HTTP client hitting `shinlink-os`'s `agent_bridge.py` on `127.0.0.1:8095` (same Pi), not a config.json reader. `imq2/integrations/telemetry_reader.py` is explicitly marked deprecated in favor of this.

**Spec assumptions that didn't hold:**
- The spec's example command used `ac_bridge.py` — the real file is **`agent_bridge.py`** (in `shinlink-os/ground/`).
- Only UDP 8000/8001 were expected as "telemetry" ports; there are 4 (8000–8003) plus ~15 more across all three projects, now 4 with AC1Companion's port 3000 added.
- No Pi Zero 2W unit or "ShinPod" (`192.168.1.183`) appears in any of the three repos — ShinPod is a separate standalone project outside this workspace (§4.9).
- **None of the primary desktop/GUI apps run under systemd** except AC1Companion's backend (Q2 uses tmux; ShinLink OS ground station is a manually-launched GUI) — the log-tail feature (§6.6) needs a `tail -f` SSH fallback, not just `journalctl -fu`, for imq2 and shinlink-os. AC1Companion is the one project where `journalctl -u ac-companion -f` works as originally spec'd.
- **PowerShell 7 (`pwsh.exe`) is not installed on this machine at all** (`C:\Program Files\PowerShell` doesn't exist). William's actual shell is Windows PowerShell 5.1, with Oh-My-Posh/PSReadLine/Terminal-Icons configured in `C:\Users\billk\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`. See §5.

---

## 2. Finalized default project configs (§7 schema)

Shell default corrected to `powershell.exe` (William's decision, §5.5). Accent colors, ports, and
commands below reflect William's resolutions.

### `imq2.json`

```jsonc
{
  "id": "imq2",
  "name": "IMQ2 / Q2",
  "accentColor": "#33FF66",          // H9000 terminal green — matches Q2's own branding
  "workingDir": "C:/Users/billk/Projects/ShinTech/imq2",
  "shell": "powershell.exe",
  "env": {},
  "targets": [
    { "id": "shinobi", "label": "Pi 5 (shinobi) — LAN", "host": "192.168.1.203", "user": "shinobi", "port": 22, "healthCheck": true },
    { "id": "shinobi-ts", "label": "Pi 5 (shinobi) — Tailscale", "host": "shinobi-ts", "user": "shinobi", "port": 22, "healthCheck": false }
  ],
  "commands": [
    { "id": "deploy", "label": "Deploy to Pi", "command": "./deploy.ps1", "hotkey": "Ctrl+1", "runIn": "new-tab" },
    { "id": "deploy-restart", "label": "Deploy + Restart Q2", "command": "./deploy.ps1 -restart", "hotkey": "Ctrl+Shift+1", "runIn": "new-tab" },
    { "id": "logs", "label": "Tail Q2 logs", "command": "ssh {targets.shinobi.user}@{targets.shinobi.host} tail -n 50 -f imq2/logs/imq2.log", "hotkey": "Ctrl+2", "runIn": "new-tab" },
    { "id": "status", "label": "Q2 status (tmux)", "command": "ssh {targets.shinobi.user}@{targets.shinobi.host} 'cd imq2 && bash scripts/q2_status.sh'", "hotkey": "Ctrl+3", "runIn": "new-tab" },
    { "id": "restart", "label": "Restart Q2 (tmux)", "command": "ssh {targets.shinobi.user}@{targets.shinobi.host} 'cd imq2 && bash scripts/q2_stop.sh && bash scripts/q2_start.sh'", "hotkey": "Ctrl+4", "runIn": "new-tab" },
    { "id": "attach", "label": "Attach Q2 tmux", "command": "ssh -t {targets.shinobi.user}@{targets.shinobi.host} 'cd imq2 && bash scripts/q2_attach.sh'", "hotkey": "Ctrl+5", "runIn": "new-tab" },
    { "id": "publish-shinagent", "label": "Publish shinagent (public sanitized)", "command": "bash tools/publish_shinagent.sh", "runIn": "new-tab" }
  ],
  "watchSync": {
    "enabled": false,
    "globs": ["**/*.py"],
    "ignore": ["**/__pycache__/**", "**/.git/**", "**/.venv/**", "logs/**", "photos/**"],
    "onChange": "deploy",
    "debounceMs": 1500
  },
  "ports": [8000, 8001, 8002, 8003, 8091, 8092, 8095, 8765, 8766, 8767],
  "restore": { "tabs": [] }
}
```

`publish-shinagent` deliberately has **no `hotkey`** — palette-only (Ctrl+Shift+P, §6.11), so an
occasional public-export action can't be fat-fingered from a terminal-focused reflex. ShinShell's
hotkey binder must treat a missing `hotkey` field as "unbound, palette-accessible only," not an error.

### `shinlink-os.json`

```jsonc
{
  "id": "shinlink-os",
  "name": "ShinLink OS",
  "accentColor": "#FF8000",          // McLaren papaya — matches ShinLink OS's own UI palette
  "workingDir": "C:/Users/billk/Projects/ShinTech/shinlink-os",
  "shell": "powershell.exe",
  "env": {},
  "targets": [
    { "id": "shinobi", "label": "Pi 5 (shinobi) — LAN", "host": "192.168.1.203", "user": "shinobi", "port": 22, "healthCheck": true },
    { "id": "shinobi-ts", "label": "Pi 5 (shinobi) — Tailscale", "host": "shinobi-ts", "user": "shinobi", "port": 22, "healthCheck": false }
  ],
  "commands": [
    { "id": "deploy", "label": "Deploy to Pi", "command": "./deploy.ps1", "hotkey": "Ctrl+1", "runIn": "new-tab" },
    { "id": "deploy-dryrun", "label": "Deploy (dry run)", "command": "./deploy.ps1 -dryrun", "hotkey": "Ctrl+Shift+1", "runIn": "new-tab" },
    { "id": "logs", "label": "Tail ground station log", "command": "ssh {targets.shinobi.user}@{targets.shinobi.host} tail -n 50 -f shinlink_os.log", "hotkey": "Ctrl+2", "runIn": "new-tab" }
  ],
  "watchSync": {
    "enabled": false,
    "globs": ["ground/**/*.py"],
    "ignore": ["**/__pycache__/**", "**/.git/**", "archive/**"],
    "onChange": "deploy",
    "debounceMs": 1500
  },
  "ports": [8095, 5760, 5761, 3232, 8080, 14550, 8554, 8889, 8888, 5000, 10110, 8010, 30003],
  "restore": { "tabs": [] }
}
```

Note: ShinLink OS's Tailscale target was added for parity — William confirmed "ShinLink deploys away
from home too," so both projects health-check the LAN IP with Tailscale as secondary, not just imq2.
No "run" command is included — the ground station always runs locally on the Pi's attached display
with real GPIO hardware and is never launched remotely (confirmed, §5.10).

### `ac1companion.json`

Discovered during this pass, not named in the original spec's Phase 0 scope — William approved
registering it as a third ShinShell project (§5.2). It's also the architecture precedent for
ShinShell itself (Electron + React + electron-builder/NSIS + `requestedExecutionLevel:
requireAdministrator` — confirmed in `package.json`), useful as a live reference during M3.

```jsonc
{
  "id": "ac1companion",
  "name": "AC1Companion",
  "accentColor": "#E10600",          // racing red
  "workingDir": "C:/Users/billk/Projects/ShinTech/AC1Companion",
  "shell": "powershell.exe",
  "env": {},
  "targets": [
    { "id": "shinobi", "label": "Pi 5 (shinobi) — LAN", "host": "192.168.1.203", "user": "shinobi", "port": 22, "healthCheck": true }
  ],
  "commands": [
    { "id": "dev", "label": "Start dev server", "command": "./scripts/dev.ps1", "hotkey": "Ctrl+1", "runIn": "new-tab" },
    { "id": "deploy-backend", "label": "Deploy backend to Pi", "command": "./scripts/deploy-backend.ps1", "hotkey": "Ctrl+2", "runIn": "new-tab" },
    { "id": "logs", "label": "Tail ac-companion service log", "command": "ssh {targets.shinobi.user}@{targets.shinobi.host} journalctl -u ac-companion -f -o cat", "hotkey": "Ctrl+3", "runIn": "new-tab" },
    { "id": "publish-public", "label": "Publish public release (sanitized)", "command": "./scripts/publish-public.ps1", "runIn": "new-tab" }
  ],
  "watchSync": { "enabled": false, "globs": ["backend/**/*.js"], "ignore": ["**/node_modules/**", "**/.git/**"], "onChange": "deploy-backend", "debounceMs": 1500 },
  "ports": [3000],
  "restore": { "tabs": [] }
}
```

`ac-companion` is a real systemd unit on shinobi, so this is the one project where the spec's
original `journalctl -fu <unit> -o cat` log-tail preset (§6.6) works exactly as written.

---

## 3. Finalized default hotkeys (§8, project-scoped)

| Key | imq2 | shinlink-os | AC1Companion |
|---|---|---|---|
| Ctrl+1 | Deploy to Pi | Deploy to Pi | Start dev server |
| Ctrl+Shift+1 | Deploy + restart Q2 | Deploy (dry run) | *(unused — reserved)* |
| Ctrl+2 | Tail Q2 logs | Tail ground station log | Deploy backend to Pi |
| Ctrl+3 | Q2 status (tmux) | *(unused — reserved)* | Tail ac-companion log |
| Ctrl+4 | Restart Q2 (tmux) | *(unused — reserved)* | *(unused — reserved)* |
| Ctrl+5 | Attach Q2 tmux | *(unused — reserved)* | *(unused — reserved)* |

`publish-shinagent` (imq2) and `publish-public` (AC1Companion) are intentionally unbound — palette
(Ctrl+Shift+P) only.

**Design decision for M6 (deploy tab):** rather than adding more hotkey slots for deploy flag
variants, the deploy tab itself gets checkboxes for `-dryrun` / `-restart` on a single Deploy button;
Ctrl+1/Ctrl+Shift+1 stay as the two most-used variants (plain deploy, deploy+restart for imq2 /
deploy dry-run for shinlink-os).

Global hotkeys per §8 (`` Ctrl+` `` summon, `Ctrl+Alt+1..9` jump-to-project, `Ctrl+Alt+T` new
terminal) need no project-specific input and are approved as spec'd.

---

## 4. Port map & collision policy

Full picture across all three projects, one Pi (shinobi):

| Port(s) | Project | Purpose |
|---|---|---|
| 8000–8003 | imq2 | Telemetry (Forza/AC-ACC/MSFS/ED) — reserved exclusive block |
| 8010 | shinlink-os | Watchtower APRS/Direwolf (moved off 8000, §5) |
| 8091, 8092 | imq2 | MSFS control / ACC setup mgr (on the *Windows PC*, not shinobi) |
| 8095 | imq2 (client) / shinlink-os (server) | Agent bridge, 127.0.0.1 only |
| 8765–8767 | imq2 | Face kiosk / webapp-PWA / Flipper Zero WS |
| 5760, 5761, 3232, 8080, 14550, 8554, 8889, 8888, 5000, 10110, 30003 | shinlink-os | Net link, OTA, lite dashboard, MAVLink, mobile video/web, AIS, dump1090 |
| 3000 | AC1Companion | Backend API + health check |

**Collision policy for the port panel (§6.8):** any port number appearing in more than one project's
`ports` array on the *same target host* gets a hard "cross-project collision" warning class,
regardless of whether both listeners are believed to run simultaneously today — this is what caught
the 8000 conflict in the first place.

---

## 5. Resolutions (William, 2026-07-09)

1. **Dev root:** canonical root is `C:\Users\billk\Projects\ShinTech\` — ShinShell registers against
   that. `imq2/README.md`'s stale path predates the ShinTech reorg; fixed separately, out of scope here.
2. **Pre-registered projects:** all three — imq2, shinlink-os, AC1Companion.
3. **Accent colors:** imq2 `#33FF66`, shinlink-os `#FF8000`, AC1Companion `#E10600` — chosen for
   taskbar-dot distinguishability, applied in §2 above.
4. **Commands:** baseline approved. Deploy-flag variants become deploy-tab checkboxes, not more
   hotkeys (§3). No additional constantly-typed commands (git aliases, venv activation, Tailscale
   checks) were flagged as missing.
5. **PowerShell / Oh-My-Posh:** **PowerShell 7 is not installed on this machine** — confirmed via
   `Get-Command pwsh` (empty) and `Test-Path "C:\Program Files\PowerShell\7\pwsh.exe"` (`False`).
   William chose to build against what's actually installed rather than requiring a PS7 install
   first: **default shell is `powershell.exe`** (Windows PowerShell 5.1), not `pwsh.exe` as the spec
   assumed. Confirmed present:
   - Profile: `C:\Users\billk\Documents\WindowsPowerShell\Microsoft.PowerShell_profile.ps1`
   - Oh-My-Posh: `C:\Users\billk\AppData\Local\Microsoft\WindowsApps\oh-my-posh.exe`, theme
     `paradox.omp.json` at `$env:USERPROFILE\oh-my-posh-themes\paradox.omp.json` (file exists)
   - Also configured: PSReadLine (`PredictionSource History`, `PredictionViewStyle ListView`, Tab →
     `MenuComplete`), `Terminal-Icons` module
   - **Implication for M1:** node-pty must spawn `powershell.exe`, not `pwsh.exe`; the acceptance
     test in §10 of the spec ("Oh-My-Posh prompt renders identically to standalone pwsh") should be
     read as "...identically to a standalone Windows PowerShell 5.1 window."
6. **Claude sign-in:** not yet confirmed by William (Google OAuth vs. email) — build the Chrome
   user-agent override regardless; harmless if unneeded. Still open, does not block M1.
7. **SSH resolution:** standardize on aliases. `~/.ssh/config` **already has** a correct entry:
   ```
   Host shinobi
       HostName 192.168.1.203
       User shinobi
       IdentityFile ~/.ssh/id_ed25519
       ServerAliveInterval 60
       ServerAliveCountMax 3
   ```
   Still needed: a `Host shinobi-ts` entry for the Tailscale hostname (tracked as a follow-up task,
   §6). `shinlink-os/deploy.ps1` is being patched to use the `shinobi` alias instead of the hardcoded
   IP (small separate commit in that repo, approved). Pi user is `shinobi`, not `billk` — corrects an
   assumption embedded in the original spec brief.
8. **Port 8000 collision:** treated as a real conflict regardless of simultaneous-use status.
   shinlink-os's Watchtower APRS/Direwolf feed moves to **8010**, leaving 8000–8003 as imq2's
   exclusive telemetry block (separate commit in shinlink-os, approved). The port panel still
   hard-flags any same-host port collision across projects going forward (§4).
9. **ShinPod / Pi Zeros:** ShinPod is a separate standalone project (Pi 1 media player) with its own
   repo outside this workspace — correctly absent from both repos, out of scope, added manually
   later if ever. Pi Zero vehicle units use dynamic Tailscale hostnames and are **not**
   pre-registered; the target schema must accept hostname strings (not just IPs) and
   `healthCheck: false` so they're easy to add ad hoc later.
10. **shinlink-os run command:** confirmed — the ground station runs on the Pi's attached display
    with real GPIO; never launch it over SSH. Deploy + log-tail only, as reflected in §2.
11. **`publish_shinagent`/`publish-public`:** in scope as commands, deliberately unbound from any
    hotkey — palette-only (§2, §3).

---

## 5a. Build environment notes (discovered during M1)

Two machine-specific issues hit while getting `node-pty` to compile natively against Electron's ABI
— neither is a ShinShell code issue, both are worth knowing if this machine is ever rebuilt or a CI
runner is set up:

- **Visual Studio Build Tools were not installed.** Installed via
  `winget install --id Microsoft.VisualStudio.2022.BuildTools -e --override "--wait --quiet --add
  Microsoft.VisualStudio.Workload.VCTools --includeRecommended"` (multi-GB, ran elevated).
- **System Python is 3.12, which removed `distutils`** (still required by `node-gyp`). Fixed with
  `python -m pip install --upgrade setuptools` (modern setuptools ships a `distutils` compatibility
  shim). No downgrade to an older Python was needed.
- **`NoDefaultCurrentDirectoryInExePath=1` is set machine-wide** (Machine-scope env var — a
  deliberate Windows security hardening setting that stops `cmd.exe` from implicitly searching the
  current directory for bare executable names). This broke `node-pty`'s winpty build step
  (`deps/winpty/src/shared/GetCommitHash.bat`, invoked as `cmd /c "cd shared && GetCommitHash.bat"`
  with no path prefix). **Left the machine-wide setting untouched** — worked around it by removing
  the env var for the single build process only (`Remove-Item Env:\NoDefaultCurrentDirectoryInExePath`
  in that PowerShell session before running `electron-builder install-app-deps`; note it must be
  fully *removed*, not set to `"0"` — the variable's mere presence triggers the restriction
  regardless of value). Anyone rebuilding `node-pty` on this machine will hit the same error and
  needs the same one-line workaround.

---

## 5b. M1 verification notes (2026-07-09)

M1 (Electron shell + terminal core) was built and verified by launching the actual app and
screenshotting it — not just typechecking. Three real bugs were found and fixed along the way:

1. **Startup banner garbled on first render.** `ResizeObserver` fires once immediately on
   `observe()` with the current size, which raced a real `pty.resize()` call against ConPTY's own
   startup redraw, garbling PowerShell's `Windows PowerShell / Copyright...` banner order. Fixed by
   only sending `pty.resize()` when cols/rows actually change from what was used at spawn
   (`Terminal.tsx`).
2. **Oh-My-Posh icon glyph rendered as a missing-glyph box.** The terminal's font stack didn't
   include a Nerd Font. Fixed by setting `fontFamily: '"Cascadia Code NF", "Cascadia Mono NF",
   Consolas, monospace'` — confirmed installed on this machine (`Cascadia Code NF` is a real font
   family here, separate from plain `Cascadia Code`).
3. **A tab that's active from the moment it mounts printed its Oh-My-Posh prompt twice** (most
   visible when 2+ tabs restore simultaneously on launch — the initially-active one duplicated,
   the hidden one didn't). Root cause not fully nailed down, but isolated to a second, differently
   -timed `fitAddon.fit()` call firing on mount for already-active tabs (meant only for tabs that
   become active *after* being hidden, where the hidden container's initial fit was against zero
   size). Fixed by skipping that re-fit on the initial mount.

Also found: React 18 `StrictMode`'s dev-only double-effect-invocation (in `npm run dev`, not
production builds) caused a *different*, cosmetically similar bug — a killed dev-mode pty's
delayed exit IPC event arrived after `StrictMode` had already re-spawned a second pty reusing the
same pane id, so the live pty's terminal briefly showed a bogus `[process exited]`. Confirmed this
does not reproduce in a production (`electron-vite build`) run — dev-mode-only noise, not shipped.

Verified end-to-end via real screenshots (not just typecheck/build): Oh-My-Posh paradox theme
renders correctly (colors + Nerd Font glyph), tab creation/switching works, session persists to
`session.json` and restores tab count + cwd + active tab correctly across a relaunch. **Not**
verified: live keyboard round-trip (typing into the terminal) — synthetic OS-level input
(`SendKeys`, `mouse_event`, `SendInput`) reliably delivered mouse clicks (confirmed via tab
creation/switching) but never delivered keystrokes into the app despite correct focus, which looks
like an input-synthesis restriction in this particular automation shell rather than an app bug.
Splits (§6.1) are implemented and code-reviewed but not visually verified this session, since
they're currently keyboard-shortcut-only (`Ctrl+\ ` / `Ctrl+Shift+\ `) and keyboard automation
didn't work — worth a manual check, or adding a UI split button in a later milestone regardless
(not everyone will discover the shortcut).

---

## 5c. M2 verification notes (2026-07-09)

M2 (projects & windows) built on M1: project config loading (seeded from `resources/default-projects/`
into `%APPDATA%/ShinShell/projects/` on first run), a launcher window (recent-projects grid +
"Open Project" folder picker), one `BrowserWindow` per open project with an accent-tinted tab strip
and a taskbar overlay dot (generated with a small dependency-free PNG encoder in `src/main/icon.ts`
using only Node's built-in `zlib` — no canvas/image library needed), and per-project session restore
(tab cwds now live in that project's own config `restore` field, not a flat global file; a small
`app-state.json` tracks which project windows were open so relaunching reopens them directly instead
of showing the launcher).

`app.setName('ShinShell')` was added so `userData` resolves to `%APPDATA%/ShinShell/` (capital),
matching the path the spec documents — the lowercase `%APPDATA%/shinshell/` from M1 testing is now
orphaned local test data, not part of the app going forward.

**A real bug surfaced and was properly fixed this milestone**, not just papered over: the "prompt
prints twice" issue from M1's notes (§5b) reappeared when a second project window opened while
another was already active — meaning M1's fix (skip re-fit on mount for already-active tabs) only
addressed one specific trigger of a more general race, not the root cause. The actual issue: the
terminal measured its container's size twice through two independent code paths (an up-front
`fitAddon.fit()` call, then whatever `ResizeObserver` reported once layout truly settled) — under
more load (a second window/renderer competing for layout time), those two measurements more often
disagreed, causing a genuine resize moments after spawn, which ConPTY/PSReadLine correctly respond
to by redrawing the prompt. Fixed by removing the second measurement entirely: the terminal now
spawns on the *first* `ResizeObserver` callback itself, so there is only ever one size measurement
and no opportunity for it to disagree with itself. Verified clean under the worst case tested —
two project windows opened in quick succession — and confirmed the restore-both-windows path also
renders cleanly.

**Diagnostic note for future sessions:** `Get-Process`'s `MainWindowTitle`/`MainWindowHandle`
properties only report *one* window per OS process — they are not reliable for checking "how many
windows does this app have open," since Electron can (and does, launcher + project windows) own
multiple top-level HWNDs under a single process. Use `EnumWindows` (all visible top-level windows)
instead when verifying multi-window behavior.

---

## 5d. M3 verification notes (2026-07-09)

M3 (elevation & packaging) shipped the zero-UAC-prompt launch strategy from spec §5: a Scheduled
Task named `ShinShell` (`RunLevel=Highest`, `LogonType=Interactive`) that desktop/Start Menu
shortcuts invoke via `schtasks /run /tn ShinShell` instead of launching the exe directly. The exe's
own manifest was changed from `requireAdministrator` to `asInvoker` — this was a real correction to
the spec's example config, not just a style choice: `requireAdministrator` would force a UAC prompt
on *every* launch path including the fallback/self-repair one, making "detect non-elevated, offer
repair" impossible to ever reach. `asInvoker` + the scheduled task is what actually delivers "no
UAC prompt on normal launches."

**A real, non-obvious bug was found and fixed while verifying, not just assumed away**: the first
version of `build/installer.nsh` built the scheduled-task-registration PowerShell command as one
long inline string embedded in the NSIS script, using NSIS's `$$` (literal `$`) and `$\'` (literal
`'`) escape sequences to avoid colliding with PowerShell's own `$env:`/`$variable` syntax. It
**compiled without error and looked correct on inspection**, but silently no-op'd at install time —
confirmed by installing (`/S` silent), then checking directly: the exe copied to Program Files
correctly, but neither the scheduled task nor the shortcuts were created. Diagnosed by adding a
temporary marker file as the first line of the macro (proved the macro *was* being entered) and
narrowing from there — the `nsExec::ExecToLog` call with the heavily-escaped inline script was the
point where execution silently stopped, before even reaching the unconditional `CreateShortcut`
lines after it.

Fixed by abandoning inline-string escaping entirely: the actual PowerShell logic now lives in plain
`build/register-task.ps1` / `build/unregister-task.ps1` files, extracted to `$PLUGINSDIR` at
install/uninstall time via NSIS's `File` command and invoked with `-File`, not `-Command`. This
sidesteps the NSIS/PowerShell `$`-collision problem by construction — the script content is never
an NSIS string literal at all. Re-verified end to end after the fix: `Get-ScheduledTask` shows
correct `RunLevel=Highest`/`LogonType=Interactive`/`UserId`/`Action`, both shortcuts exist with
`TargetPath=schtasks.exe` and the right `/run /tn ShinShell` arguments, and launching via
`schtasks /run /tn ShinShell` (exactly what the shortcut does) produced an elevated main process
(confirmed via a direct Win32 `TokenElevation` check, not just "it looked like it worked") in
~2 seconds with no UAC dialog. The ADMIN badge correctly shows green in the running app.

**Diagnostic note:** for a `perMachine: true` NSIS install, `$DESKTOP`/`$SMPROGRAMS` resolve to the
**all-users** locations (`C:\Users\Public\Desktop`, `C:\ProgramData\...\Start Menu\Programs`), not
the current user's own — worth remembering before concluding a per-machine installer's shortcuts
"didn't get created" when checking only `$env:USERPROFILE`.

Not yet live-tested: the in-app self-repair flow (`AdminBadge`'s Repair button →
`repairAndRelaunch()` in `src/main/elevation.ts`). Lower risk than the installer script was, though
— it builds its PowerShell command via plain Node.js template-literal interpolation passed through
`execFile` (argv-based, no shell involved), not NSIS string escaping, so the specific failure mode
found above doesn't apply there. Worth a manual click-through once the app is in a genuinely
non-elevated state to confirm.

---

## 5e. M4 verification notes (2026-07-09)

M4 (commands & hotkeys) added: `{workingDir}` / `{env.NAME}` / `{targets.<id>.<field>}` variable
substitution (§7); `runCommand` dispatch per a command's `runIn` (`new-tab` spawns a fresh terminal
and types the command + Enter; `active-terminal` types into the focused pane's input *without*
Enter, per spec — left for the user to review/edit; `background` fires via the main process with no
visible terminal, since there's no output surface for it yet — that's the deploy tab, §6.7/M6);
project-scoped hotkeys matching each command's own `hotkey` string (not a hardcoded Ctrl+1..9
assumption — reads whatever combo is in the config, matching the spec's config-driven design);
global hotkeys (`` Ctrl+` `` summon/hide the last-focused project window, `Ctrl+Alt+1..9` jump to
the Nth project, `Ctrl+Alt+T` new terminal tab in the last-focused project); and hotkey conflict
detection (`findHotkeyConflicts`) — no settings UI exists yet to surface it in, so conflicts log to
the console for now rather than blocking config load (the config JSON is already meant to be
human-editable directly, per §3).

**Verified:** variable substitution and conflict detection were run directly against all 11 real
commands across all 3 seed configs (not synthetic test data) — every `{targets.shinobi.user}` /
`{targets.shinobi.host}` substitution produced the correct real values (`shinobi` /
`192.168.1.203`), and conflict detection correctly found zero conflicts (as expected — the hotkey
table was designed collision-free back in Phase 0). Confirmed no regressions: the app still launches
and all three project windows still load and spawn terminals correctly with the new code active.

**Not live-verified:** actually pressing a hotkey (project-scoped Ctrl+1..9/command-specific, or the
global Ctrl+`` ` ``/Ctrl+Alt+1..9/Ctrl+Alt+T bindings) — this environment's synthetic keyboard input
doesn't reliably reach the app (same limitation noted in M1/M2: `SendKeys`/`SendInput` deliver mouse
clicks fine but not keystrokes here). Didn't work around it by actually triggering a real deploy/SSH
command either, since several of the real bound commands (`./deploy.ps1`, SSH to shinobi) touch
real infrastructure — not something to fire off as a side effect of UI testing. Worth a manual
press-through: open IMQ2, hit Ctrl+2 (should open a new tab and run the log-tail SSH command), hit
Ctrl+3 (status, also SSH — safe/read-only either way).

---

## 5f. M5 verification notes (2026-07-09)

M5 (Claude & editor tabs) added three new tab kinds on top of terminal, extending the `Tab` type
into a discriminated union (`terminal | claude-code | claude-chat | editor | scratchpad`):

- **claude-chat** (§6.3): a `WebContentsView` per tab, shared `persist:claude-chat` session
  partition (so signing in once works across every project window), a standard Chrome UA string
  (Electron's default UA gets rejected by Google's OAuth flow outright), external links routed to
  `shell.openExternal` via `setWindowOpenHandler`, and a back/forward/reload toolbar driven by
  `webContents.navigationHistory`. Bounds are reported by the renderer via `ResizeObserver` and
  applied with `view.setBounds()` — the view is attached/detached from `win.contentView` on tab
  switch (not destroyed), so the underlying page and its session survive switching away and back.
- **claude-code** (§4): not a separate mechanism — just a terminal tab whose pane gets `claude`
  queued as its initial command, reusing the exact same "type + Enter after spawn" path M4 built
  for `runIn: "new-tab"` commands.
- **editor / scratchpad** (§6.4): `monaco-editor` installed directly (no React wrapper, same
  ref+`useEffect` pattern as `Terminal.tsx`'s xterm.js integration), with local (non-CDN) worker
  bundling via Vite's `?worker` imports — required for an app that needs to work without internet
  access; monaco's default self-registration tries to fetch workers from a CDN. Editor tabs get
  Open/Save dialogs and file read/write over IPC; the scratchpad is a fixed per-project file
  (`%APPDATA%/ShinShell/scratchpads/<projectId>.md`) with debounced auto-save and no manual save
  affordance at all, and is a *singleton* — reopening it via `+Pad` focuses the existing tab rather
  than creating a duplicate.

**A real UX finding, not just an automation footnote:** the first version of the "+" new-tab control
was a single `<select>` dropdown (5 tab kinds as options). It technically worked, but automating it
here kept "selecting" the first real option on a single click instead of opening for a second pick —
which turned out to be a legitimate signal, not just a quirk of this environment: a two-click hidden
dropdown is worse UX than discoverable buttons for a 5-item, always-relevant action. Replaced it with
a small row of buttons (`+Term +CC +Chat +Edit +Pad`) — fewer clicks, more discoverable, and
consistent with the rest of the app's plain-button UI.

**Verified end-to-end, not just built:** all 5 tab kinds were exercised in the actual running app.
Claude chat loads the real claude.ai sign-in page with a working "Continue with Google" button
visible (confirms the UA override defeats Electron's default-UA rejection — did not complete the
actual OAuth flow, since that would sign in with a real account and is Willem's to do, not mine to
trigger during verification). The claude-code preset launched an actual working Claude Code session
(v2.1.205, Sonnet 5, correct project working directory) — confirming the initial-command mechanism
fires correctly for this tab kind too. Monaco loads and renders correctly with no CDN/worker errors.
Save dialog opens correctly (confirmed via Cancel — didn't type a filename to complete the save,
since typing doesn't reliably reach the app in this environment, same limitation as M1-M4). A mixed
set of 6 tabs (3 terminal + claude-chat + editor + scratchpad, then also claude-code) was created,
and every one of them survived a full app relaunch with the correct kind, label, and content
restored — including the claude-chat tab correctly reloading claude.ai fresh (no scrollback/session
*state* restore, consistent with spec's "no scrollback restore" principle applied to browser tabs
too, though the underlying login session itself does persist via the shared partition).

**Known tradeoff:** bundling `monaco-editor` grew the renderer bundle from ~780KB to ~8MB (monaco
ships every language's tokenizer/worker by default). Not a problem for a desktop app's install size,
but worth a look during M7 polish if it ever matters — `monaco-editor`'s language contributions can
be trimmed to just the languages actually needed instead of importing the whole package.

---

## 6. Remaining follow-up work (tracked, not blocking M1)

- [x] Add `Host shinobi-ts` to `~/.ssh/config` — added, pointed at `100.95.193.115` (the Tailscale IP
      quoted in `imq2/README.md`; no MagicDNS tailnet name is recorded anywhere in either repo, so the
      raw IP was used instead of guessing `shinobi.<tailnet>.ts.net`). **Not connectivity-tested** —
      Tailscale IPs can be reassigned if the device re-registers; confirm this still resolves before
      relying on it for the health-check secondary target.
- [x] Patch `shinlink-os/deploy.ps1`: `$REMOTE_HOST = "192.168.1.203"` → `"shinobi"` alias (commit `a2dd26b`)
- [x] Patch `shinlink-os/ground/shinlink_os.py`: `var_wt_aprs_port` default `8000` → `8010`, plus 3 stale comments (commit `ae3186c`)
- [ ] Confirm Claude sign-in method (Google OAuth vs. email) — open, non-blocking

---

*Resolved 2026-07-09. Proceeding to Milestone 1 (Electron shell + terminal core) per §9.*
