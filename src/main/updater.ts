import { app, BrowserWindow, dialog } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateInfo } from 'electron-updater'

// § update check on startup — GitHub Releases is the feed (via the
// `publish` block in package.json's `build` config, embedded into the
// packaged app as app-update.yml at build time). Prompt-first: never
// auto-download without the user clicking "Update now."
const CHECK_DELAY_MS = 10_000
const RELEASE_NOTES_MAX_LINES = 4

autoUpdater.autoDownload = false

let interactiveCheck = false

function firstLines(text: string, maxLines: number): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, maxLines)
    .join('\n')
}

function summarizeReleaseNotes(notes: UpdateInfo['releaseNotes']): string {
  if (!notes) return ''
  if (typeof notes === 'string') return firstLines(notes.replace(/<[^>]+>/g, ''), RELEASE_NOTES_MAX_LINES)
  // Array form only shows up when `fullChangelog` is enabled (it isn't
  // here), but the type allows it — handle it rather than assume.
  const combined = notes.map((n) => n.note ?? '').join('\n')
  return firstLines(combined.replace(/<[^>]+>/g, ''), RELEASE_NOTES_MAX_LINES)
}

function setProgressOnAllWindows(progress: number): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.setProgressBar(progress)
  }
}

let promptOpen = false

function promptForUpdate(info: UpdateInfo): void {
  if (promptOpen) return
  promptOpen = true
  const notes = summarizeReleaseNotes(info.releaseNotes)
  dialog
    .showMessageBox({
      type: 'info',
      title: 'Update available',
      message: `ShinShell ${info.version} is available (you have ${app.getVersion()}).`,
      detail: notes ? `Release notes:\n${notes}` : undefined,
      buttons: ['Update now', 'Remind me next launch'],
      defaultId: 0,
      cancelId: 1,
      noLink: true
    })
    .then((result) => {
      promptOpen = false
      if (result.response === 0) {
        // Download progress mirrors the deploy tab's pattern (§UX3) — taskbar
        // setProgressBar while running, cleared on completion/failure.
        autoUpdater.downloadUpdate().catch((err) => {
          console.warn('[updater] downloadUpdate failed:', err instanceof Error ? err.message : err)
          setProgressOnAllWindows(-1)
        })
      }
    })
}

export function checkForUpdates(interactive = false): void {
  if (!app.isPackaged) {
    // §4 — skip entirely in dev; a manual trigger from a dev build just
    // says so instead of silently doing nothing with no explanation.
    if (interactive) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Check for updates',
        message: 'Update checks only run in packaged builds.'
      })
    }
    return
  }
  interactiveCheck = interactive
  autoUpdater.checkForUpdates().catch((err) => {
    // § all updater errors fail silent to a log line — offline, rate-limited,
    // or a malformed feed are all just "no update today," never a crash and
    // never a dialog on the *automatic* (startup) path.
    console.warn('[updater] checkForUpdates failed:', err instanceof Error ? err.message : err)
    if (interactiveCheck) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Check for updates',
        message: 'Could not check for updates. See the app log for details.'
      })
    }
    interactiveCheck = false
  })
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) return // §4 — dev builds never touch the updater at all

  autoUpdater.on('error', (err) => {
    console.warn('[updater] error:', err instanceof Error ? err.message : err)
    setProgressOnAllWindows(-1)
    if (interactiveCheck) {
      dialog.showMessageBox({
        type: 'warning',
        title: 'Check for updates',
        message: 'Could not check for updates. See the app log for details.'
      })
    }
    interactiveCheck = false
  })

  autoUpdater.on('update-available', (info) => {
    interactiveCheck = false
    promptForUpdate(info)
  })

  autoUpdater.on('update-not-available', () => {
    if (interactiveCheck) {
      dialog.showMessageBox({
        type: 'info',
        title: 'Check for updates',
        message: `ShinShell ${app.getVersion()} is up to date.`
      })
    }
    interactiveCheck = false
  })

  autoUpdater.on('download-progress', (progress) => {
    setProgressOnAllWindows(progress.percent / 100)
  })

  autoUpdater.on('update-downloaded', () => {
    setProgressOnAllWindows(-1)
    // The downloaded artifact is the same NSIS installer this app ships —
    // its customInstall macro (build/installer.nsh) re-registers the
    // "ShinShell" scheduled task exactly as a fresh install does, so the
    // zero-UAC launch path survives the update. isSilent=true skips the
    // wizard; isForceRunAfter=true relaunches when it's done. Since this
    // app only ever runs elevated (via the scheduled task), the child
    // installer process inherits that same elevated token — no UAC prompt
    // mid-update. (A copy launched by double-clicking the exe directly,
    // bypassing the scheduled task, would already be flagged by the
    // ADMIN badge/self-repair flow before it ever got here.)
    autoUpdater.quitAndInstall(true, true)
  })

  // On app ready + 10s delay — don't compete with window spin-up.
  setTimeout(() => checkForUpdates(false), CHECK_DELAY_MS)
}
