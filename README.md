# ShinShell

**One elevated window to rule them all.**

ShinShell exists because William once had six PowerShell windows open, all of them
titled "Windows PowerShell," and confidently piped a deploy command into the wrong
one. If you have ever restarted the wrong service, `git push`ed from the wrong repo,
or watched a command execute in a terminal you *swore* was pointed at the Pi —
this app is for you. This app is for us.

It's a Windows desktop shell that consolidates the whole ShinTech dev loop —
PowerShell terminals, Claude chat, an editor, and one-keystroke deploys to the Pi —
into **color-coded project windows** so you always, *always* know which project
you're about to break.

- **Dev machine:** ScarlettWitch (Windows 11 Pro, user `billk`)
- **Prime deploy target:** shinobi, a Raspberry Pi 5 that has seen things
- **Dev root:** `C:\Users\billk\Projects\ShinTech\`
- **Status:** Phase 0 (discovery) complete ✅ — building toward M1

> **For Claude Code:** this file is the authoritative brief. `docs/DISCOVERY.md`
> holds the Phase 0 inventory and William's resolved answers. Sibling repos are
> reference-only — look, don't touch.

---

## The pitch

Every open project gets its **own OS window**, tinted with that project's accent
color, with a matching colored dot on the taskbar icon. Inside each window: tabs.

| Tab type | What it is |
|---|---|
| `terminal` | Real `pwsh.exe` via ConPTY. Oh-My-Posh renders untouched. Splits supported. |
| `claude-code` | A terminal preset that just runs `claude` in the project dir. |
| `claude-chat` | claude.ai in an embedded browser, session persists across restarts. |
| `editor` | Monaco — the literal VS Code editor component, not a sad textarea. |
| `scratchpad` | Auto-saved per-project markdown for notes and "don't forget" lists. |
| `log-tail` | SSH into the Pi and watch logs scroll by. Very soothing. |
| `deploy` | Big deploy button, flag toggles, streamed output, SSH health light. |

And the whole app runs **persistently elevated with zero UAC prompts** (§ Elevation),
because clicking "Yes" forty times a day builds no character whatsoever.

### The projects (and their colors)

| Project | Accent | Why |
|---|---|---|
| **imq2 / Q2** | `#33FF66` | H9000 terminal green — Q2's own face |
| **shinlink-os** | `#FF8000` | McLaren papaya, matching its UI |
| **AC1Companion** | `#E10600` | Racing red, obviously |

If you're about to type a deploy command and the window chrome is *green*, you're
talking to Q2. If it's *papaya*, hands off the CRSF hardware. That's the entire
thesis of this application.

---

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Shell | **Electron + React + TypeScript** | Same stack as AC1Companion; known territory |
| Terminal | **xterm.js + node-pty** | The VS Code combo. ConPTY → real pwsh → Oh-My-Posh just works |
| Browser tab | **WebContentsView** | Persistent session partition; Chrome user-agent override so Google OAuth doesn't sulk |
| Editor | **Monaco** | Free VS Code editor, zero excuses |
| File watch | **chokidar** | For watch-and-sync mode |
| Config | JSON in `%APPDATA%/ShinShell/` | Human-editable, portable |
| Packaging | **electron-builder** (NSIS) | AC1Companion already proved this pipeline |

Rules of the road: all pty/fs work in the main process, typed IPC channels to the
renderer, PowerShell 7 (`C:\Program Files\PowerShell\7\pwsh.exe`) as the default
shell spawned with the normal profile so Oh-My-Posh loads exactly like standalone.
xterm.js WebGL renderer on, fit addon handling resizes.

---

## Elevation: admin forever, prompts never

The trick is a **Windows Scheduled Task**:

1. The installer (elevated once) registers task `ShinShell` — *Run with highest
   privileges*, trigger on demand, action: launch the app.
2. The desktop/taskbar shortcut runs `schtasks /run /tn "ShinShell"` — the app
   launches elevated and UAC never says a word.
3. If the task is missing (new machine, someone got tidy), the app detects it's
   not elevated and offers a one-click self-repair.
4. A small **ADMIN** badge lives in the UI at all times, because silent power is
   how accidents happen.

**The honest tradeoff:** *everything* inherits admin — terminals, Claude Code,
the embedded browser. Also, Windows UIPI blocks drag-and-drop from non-elevated
Explorer into elevated windows, so there's a proper Open File dialog instead.
We accept this. We accepted it the fortieth time UAC asked if we were sure.

---

## Features

### P0 — the reason this exists

1. **Terminals** — unlimited pwsh tabs per project, opened in the project dir,
   Oh-My-Posh intact, copy/paste, search, splits, font config.
2. **Project windows** — color-coded per the table above, taskbar overlay dots
   (`setOverlayIcon`), in-app project create/edit.
3. **Claude chat tab** — persistent login, back/forward/reload, external links
   punt to the default browser.
4. **Editor + scratchpad** — Monaco with open/save into the project tree.
5. **Hotkey command system** — see Hotkeys below.
6. **Zero-prompt elevation** — see above.
7. **Session restore** — kill the app, relaunch, everything comes back
   (windows, tabs, working dirs; scrollback gets to die).

### P1 — the quality of life

8. **Log-tail tab** — runs *any configured SSH command* (learned in Phase 0:
   neither main app uses systemd, so no journalctl assumptions). Q2 logs to
   `imq2/logs/imq2.log`; ShinLink's ground station logs to
   `/home/shinobi/shinlink_os.log`. `tail -f` is the workhorse; journalctl is
   only for the Pi-Zero vehicle services. Reconnect button, connection state dot.
9. **Deploy tab + SSH health** — deploy button with **flag toggles** (checkboxes
   for `-dryrun` / `-restart` instead of a hotkey per permutation), streamed
   output, deploy history (last 20 runs, exit codes, durations), and a health
   light that TCP-pokes port 22 on the primary target every ~15s.
10. **Port/process panel** — lists listening ports, filterable, per-row kill.
    Ports named in project configs get highlighted, and any port claimed by
    **two** projects gets a special cross-project collision warning — a class
    of bug we discovered *while writing this spec* (UDP 8000: imq2's Forza
    listener vs. Watchtower's APRS feed, same Pi 🎉). Resolution: APRS moves
    to **8010**; 8000–8003 is telemetry's block now, no squatters.
11. **Global summon** — Ctrl+` toggles the most recent project window,
    quake-style.

### P2 — the victory lap

12. **Watch-and-sync** — chokidar on configured globs → deploy on save,
    debounced. The dev loop becomes *save and it's on the Pi*.
13. **Command palette** — Ctrl+Shift+P fuzzy search over every saved command,
    tab action, and project. Also home to deliberately-hotkey-less commands
    like `Publish shinagent (public sanitized)` — some things should require
    intent.
14. **Git status in tab strip** — branch + dirty dot per project.
15. **Theming** — dark default, ShinTech/H9000 aesthetic encouraged, readability
    beats vibes.

**Non-goals for v1:** SSH multiplexing UI (just spawn `ssh` in a pty), plugins,
macOS/Linux, tray-only mode, settings sync. Scope creep is how apps die young.

---

## Project config

One JSON per project in `%APPDATA%/ShinShell/projects/`. Real defaults for all
three projects live in `docs/DISCOVERY.md` §2 (extracted from the actual repos,
not vibes). The shape:

```jsonc
{
  "id": "imq2",
  "name": "IMQ2 / Q2",
  "accentColor": "#33FF66",
  "workingDir": "C:/Users/billk/Projects/ShinTech/imq2",
  "shell": "pwsh.exe",
  "env": {},
  "targets": [
    { "id": "shinobi",    "label": "Pi 5 (shinobi) — LAN",       "host": "shinobi",    "user": "shinobi", "port": 22, "healthCheck": true  },
    { "id": "shinobi-ts", "label": "Pi 5 (shinobi) — Tailscale", "host": "shinobi-ts", "user": "shinobi", "port": 22, "healthCheck": false }
  ],
  "commands": [
    { "id": "deploy",         "label": "Deploy to Pi",       "command": "./deploy.ps1",          "hotkey": "Ctrl+1",       "runIn": "new-tab" },
    { "id": "deploy-restart", "label": "Deploy + Restart Q2","command": "./deploy.ps1 -restart", "hotkey": "Ctrl+Shift+1", "runIn": "new-tab", "dangerous": true },
    { "id": "logs",           "label": "Tail Q2 logs",       "command": "ssh {targets.shinobi.host} tail -n 50 -f imq2/logs/imq2.log", "hotkey": "Ctrl+2", "runIn": "new-tab" },
    { "id": "attach",         "label": "Attach Q2 tmux",     "command": "ssh -t {targets.shinobi.host} 'cd imq2 && bash scripts/q2_attach.sh'", "hotkey": "Ctrl+5", "runIn": "new-tab" }
  ],
  "watchSync": { "enabled": false, "globs": ["**/*.py"], "ignore": ["**/__pycache__/**", "**/.git/**", "**/.venv/**"], "onChange": "deploy", "debounceMs": 1500 },
  "ports": [8000, 8001, 8002, 8003, 8091, 8092, 8095, 8765, 8766, 8767],
  "restore": { "tabs": [] }
}
```

Command strings support `{targets.<id>.<field>}`, `{workingDir}`, and
`{env.<NAME>}` substitution. `runIn` is `new-tab` | `active-terminal` |
`background`. Targets accept hostnames or IPs (Pi Zeros use dynamic Tailscale
hostnames, so they'll be added ad hoc with `healthCheck: false`). Commands
marked `"dangerous": true` don't fire on the first keypress — see
**arm-to-confirm** in the UX section.

**Seed drift:** a project's config is only ever copied from these defaults
once, into a brand-new (empty) `%APPDATA%/ShinShell/projects/` — after that
it's the user's file, and `ensureSeeded()` never touches it again. So a field
added to a default command later (like `deploy-restart`'s `dangerous: true`)
still reaches an install that already has that project on disk,
`getProject`/`listProjects` backfill any command field present in the seed
but missing from the saved copy, matched by command id. Never overwrites a
field — or an explicit override like `"dangerous": false` — the user's copy
already has, and never resurrects a command the user deleted.

**SSH convention (decided in Phase 0):** aliases everywhere. `~/.ssh/config`
defines `Host shinobi` (LAN) and `Host shinobi-ts` (Tailscale); ShinShell
configs and both projects' `deploy.ps1` reference the alias. Hardcoded IPs are
how you end up deploying to a router. Note the Pi user is `shinobi`, not `billk`
— the machines have callsigns too.

---

## Hotkeys

Two scopes, one philosophy: same slot = same *kind* of action in every project,
so muscle memory transfers.

**Global (OS-wide):**

| Key | Action |
|---|---|
| Ctrl+` | Summon/hide most recent project window |
| Ctrl+Alt+1..9 | Jump to project N |
| Ctrl+Alt+T | New terminal in active project |

**Project-scoped (per the configs):**

| Key | imq2 | shinlink-os | AC1Companion |
|---|---|---|---|
| Ctrl+1 | Deploy to Pi | Deploy to Pi | Deploy |
| Ctrl+Shift+1 | Deploy + restart Q2 | Deploy (dry run) | — |
| Ctrl+2 | Tail Q2 logs | Tail ground station log | — |
| Ctrl+3 | Q2 status (tmux) | *(reserved)* | — |
| Ctrl+4 | Restart Q2 (tmux) | *(reserved)* | — |
| Ctrl+5 | Attach Q2 tmux | *(reserved)* | — |

Plus the usual: Ctrl+T new tab, Ctrl+W close, Ctrl+Tab cycle. All bindings
editable, with conflict detection. Commands can either execute in a new tab or
be **injected into the active terminal without pressing Enter** — typed but not
fired, cursor at the end, for the trust-but-verify crowd.

One deliberate exception: `shinlink-os` gets **no remote "run" hotkey**. The
ground station is a Tkinter GUI driving real GPIO (CPPM/S.BUS/CRSF) on the Pi's
attached display. You do not launch that over SSH. You walk over to it like a
gentleman.

---

## UX details (the anti-wrong-window kit)

The design test for everything in this section: does it *reinforce knowing where
you are*, or *reduce keystrokes you already type*? If neither, it doesn't ship.
These aren't features — they're guardrails on the features above.

1. **Color where your eyes actually are.** Window chrome is easy to tune out
   once a terminal is full-screen, so the accent color follows your focus: a
   thin accent strip along the top of every tab's content area, and — the
   sneaky one — an env var (`SHINSHELL_PROJECT`, `SHINSHELL_ACCENT`) injected
   into every pty so an Oh-My-Posh segment renders the project name, in the
   project color, **inside the prompt itself**. You look at the prompt when
   you type. That's where the guardrail lives.
2. **Arm-to-confirm on dangerous commands.** Commands flagged `dangerous: true`
   don't fire on the hotkey — they *arm*. The deploy button pulses in the
   accent color showing exactly what's loaded ("Deploy + Restart Q2 →
   shinobi"), and the same key confirms within 3 seconds or it disarms. One
   extra keystroke, only where the wrong-window mistake actually hurts.
   Regular deploys stay one-touch.
3. **Outcomes without babysitting.** Deploys are long enough to tab away from:
   `setProgressBar` on the taskbar icon while running, then a toast + brief
   taskbar flash on completion — green or red. A failed run also leaves its
   tab glowing red until it's been looked at. Exit code 1 does not get to
   scroll quietly into history.
4. **Hotkey sidebar.** Ctrl+1–5 means different things per project *by
   design*, so the bindings live in a **collapsible sidebar** instead of
   cluttering the top of the window: a slim icon rail on the right edge that
   expands on **Ctrl+/** (or clicking the rail) into a panel listing the
   current project's commands — hotkey, label, target — in the project's
   accent color, with `dangerous` commands marked. Rows are clickable (click =
   run, same arm rules apply), so it doubles as a mouse-friendly command list
   for the dev buddies. Auto-collapses on Esc or refocusing the terminal;
   pinnable open for learning week. Collapsed, it's ~40px of icons; the
   terminal keeps the real estate.
5. **A health light that earns its tooltip.** The SSH dot stays binary at a
   glance, but hovering it answers the whole "is the Pi okay" question:
   round-trip latency, LAN vs. Tailscale resolution, time since last
   successful deploy, and that deploy's exit code.
6. **Tab titles that describe state, not type.** "Terminal 2" tells you
   nothing; `~/imq2 (main*)` — cwd + git branch + dirty marker — is
   orientation. Log-tail tabs surface connected/reconnecting state in the
   title.
7. **Color-first quick-switch.** Holding Ctrl+Alt pops a strip of colored
   project chips — alt-tab, but switching is a *color choice* instead of
   reading window titles. Same thesis, smallest possible form.

Build priority if it comes down to it: prompt indicator (1) → arm-to-confirm
(2) → completion toasts (3). Those three attack the founding mistake directly.

---

## Milestones

Each milestone runs end-to-end before the next begins. Commit per milestone.

- **M0 — Discovery** ✅ `docs/DISCOVERY.md` written, all 11 questions answered.
- **M1 — Terminal core:** shell + xterm.js/node-pty tabs, Oh-My-Posh verified
  pixel-identical to standalone pwsh, splits, terminal session restore.
- **M2 — Projects & windows:** config schema, launcher window, per-project
  windows, accent colors, taskbar dots, accent content strips, and the
  `SHINSHELL_*` env vars + Oh-My-Posh prompt segment (UX 1).
- **M3 — Elevation & packaging:** NSIS installer, scheduled-task registration,
  zero-prompt elevated launch verified, ADMIN badge. (Crib from AC1Companion's
  electron-builder setup.)
- **M4 — Commands & hotkeys:** saved commands, variable substitution, both
  hotkey scopes, injection mode, arm-to-confirm for `dangerous` commands
  (UX 2), collapsible hotkey sidebar (UX 4).
- **M5 — Claude & editor tabs:** claude-chat WebContentsView with OAuth verified,
  claude-code preset, Monaco + scratchpad.
- **M6 — Pipeline features:** deploy tab with flag toggles, SSH health with
  rich tooltip (UX 5), completion toasts + taskbar progress + red failed-tab
  glow (UX 3), log-tail, port panel with collision warnings, stateful tab
  titles (UX 6).
- **M7 — Polish:** watch-and-sync, command palette, git status, color-first
  quick-switcher (UX 7), theming, README.

---

## Definition of "it works"

- [ ] Taskbar click → elevated window in <3s, UAC silent
- [ ] `whoami /groups` shows elevated; Oh-My-Posh prompt identical to standalone pwsh
- [ ] Two projects open = two windows, unmistakably different colors, distinguishable in the taskbar
- [ ] Ctrl+1 in the green window deploys Q2; Ctrl+1 in the papaya window deploys ShinLink — *and you can tell which is which before you press it* (the entire point)
- [ ] Claude tab stays signed in across app restarts
- [ ] Force-kill the app → relaunch restores every window, tab, and working dir
- [ ] Pull the Pi's ethernet → SSH light goes red within ~30s
- [x] The prompt itself shows the project name in the project color — full-screen terminal, chrome invisible, you still know where you are
- [ ] Ctrl+Shift+1 arms (does not fire) Deploy + Restart; second press within 3s fires it; waiting disarms it
- [ ] A failed deploy leaves visible evidence (red tab glow + toast) even if you were in another window when it died
- [ ] Ctrl+/ expands the hotkey sidebar to a clickable command list in the project's accent color; clicking into a terminal (or Esc) collapses it again unless pinned
- [ ] Everything except the Claude tab and remote features works offline

## House rules (for Claude Code)

- Ask before adding dependencies beyond the architecture table.
- Sibling repos are **read-only reference**. The one-commit fixes noted in
  Phase 0 (shinlink deploy.ps1 alias, APRS → 8010, stale README path) happen
  in *those* repos, separately — not smuggled in here.
- No secrets in the repo. SSH rides the existing key setup; do not build
  password storage.
- Windows-only. Every hour spent on cross-platform abstraction is an hour the
  deploy button doesn't exist.
- When unsure how something actually works, check the sibling repos first,
  then ask William. The repos remember; humans improvise.
