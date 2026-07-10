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
