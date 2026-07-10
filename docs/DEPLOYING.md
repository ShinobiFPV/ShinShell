# Deploying (rebuild + reinstall on ScarlettWitch)

Crib sheet, not a manual. If you're doing anything more exotic than "ship the
latest commit to the machine that's already running ShinShell," you're on
your own.

## Reinstall procedure

```powershell
taskkill /F /IM ShinShell.exe                # ignore "not found", that's fine

npm run release                               # electron-vite build + electron-builder NSIS
                                               # → dist\ShinShell Setup <version>.exe

# Run the installer silently. Plain /S — nothing else. See the warning below.
Start-Process "dist\ShinShell Setup <version>.exe" -ArgumentList '/S' -Wait

# The installer's customInstall macro re-registers the scheduled task on
# every install — you shouldn't need to touch it, just verify:
schtasks /query /tn ShinShell /v /fo list     # Task To Run must be
                                               # C:\Program Files\ShinShell\ShinShell.exe

schtasks /run /tn ShinShell                   # launches elevated, no UAC prompt
```

That's the whole happy path. If `Task To Run` doesn't match the installed
exe path, something's actually wrong — the macro failing silently is not
supposed to happen, don't just re-register by hand and move on.

> [!WARNING]
> **Never pass `/D=` to this installer.** NSIS requires `/D=<dir>` to be the
> *final* argument and completely unquoted, even though the path
> (`C:\Program Files\ShinShell`) has a space in it. Quote it, or put
> anything after it, and NSIS truncates the path at the first space instead
> of erroring — we hit exactly this on 2026-07-10 and got a phantom install
> at `C:\Program\` plus an orphaned uninstall registry entry pointing at a
> path that no longer existed. Plain `/S` is always correct here anyway: the
> installer's per-machine default already resolves to
> `C:\Program Files\ShinShell`, which is where the existing install lives.

## Secrets

OAuth client secrets (Google, etc.) live in `%APPDATA%\ShinShell\`, never
the repo root. `client_secret_*.json` is gitignored — if you find one sitting
in the working tree, it wandered in by accident and needs to move, not get
committed.

## Releasing

`.github/workflows/release.yml` publishes a GitHub Release the moment a
`v*` tag lands on `main` — that's the *only* path. Never hand-upload an
installer to Releases; if the workflow didn't build it, it doesn't ship.

```powershell
# 1. Bump the version — package.json's "version" field is the source of truth.
#    (edit it directly, or `npm version patch|minor|major` which also commits + tags)

# 2. Tag and push
git tag v0.2.0
git push --tags
```

That's it. The workflow checks out the tag, `npm ci`, then
`npm run release:publish` (`electron-builder --publish always`) with
`GH_TOKEN` from the repo's built-in `secrets.GITHUB_TOKEN` — no PAT to
manage. The installer, `latest.yml`, and the `.blockmap` all land on the
Release electron-updater's clients poll.

Locally, `npm run release` (no `:publish`) still builds the same installer
into `dist\` without touching GitHub — that's the safe default for
"just let me test the installer" from docs/DEPLOYING.md's reinstall
procedure above.

## Unsigned build reality check

We don't code-sign. Two consequences, both fine to live with for now:

- **First-time downloaders see SmartScreen.** "Windows protected your PC" →
  **More info** → **Run anyway**. This is a one-time-per-machine speed bump
  on the initial install, not something update checks trigger — silent
  NSIS updates via `quitAndInstall` don't go through the Explorer
  double-click path SmartScreen gates.
- **electron-updater itself doesn't care.** It verifies the downloaded
  installer's `sha512` against `latest.yml`, not a code-signing cert, so
  unsigned auto-updates work today with no special config.

> **TODO if a signing cert ever shows up:** electron-updater's Windows
> differential-update path checks the *publisher name* on old vs. new
> installer to decide whether a diff patch is safe to apply. Adding signing
> later means the first signed release must either match whatever
> publisher name (or lack of one) unsigned builds shipped with, or updates
> from the last unsigned version will silently fail to apply as a diff
> (full download still works, but don't assume the diff path "just keeps
> working" the day signing lands — test one real update through it).
