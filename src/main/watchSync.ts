import chokidar, { type FSWatcher } from 'chokidar'
import { exec } from 'child_process'
import { app, BrowserWindow } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { IPC, type WatchSyncActivityEntry } from '../shared/ipc'
import { getProject, saveProject } from './projects'
import { substituteVariables } from '../shared/commandSubstitution'
import { validateProjectPath } from './projectValidation'

// §6.10 — watches a project's configured globs, and on change (debounced)
// runs the referenced command. Ambient/background by design: no visible
// terminal, just an activity log (below), so saving a file doesn't pop up
// a window every time.

const MAX_ACTIVITY = 20
const watchers = new Map<string, FSWatcher>()
const debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

const activityDir = (): string => join(app.getPath('userData'), 'watch-activity')
const activityPath = (projectId: string): string => join(activityDir(), `${projectId}.json`)

export function getActivity(projectId: string): WatchSyncActivityEntry[] {
  const path = activityPath(projectId)
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as WatchSyncActivityEntry[]
  } catch {
    return []
  }
}

function appendActivity(entry: WatchSyncActivityEntry, win: BrowserWindow | null): void {
  const entries = [entry, ...getActivity(entry.projectId)].slice(0, MAX_ACTIVITY)
  mkdirSync(activityDir(), { recursive: true })
  writeFileSync(activityPath(entry.projectId), JSON.stringify(entries, null, 2), 'utf-8')
  if (win && !win.isDestroyed()) win.webContents.send(IPC.watchSyncActivity, entry)
}

function triggerSync(projectId: string, changedPath: string, win: BrowserWindow | null): void {
  const config = getProject(projectId)
  if (!config) return
  const cmd = config.commands.find((c) => c.id === config.watchSync.onChange)
  if (!cmd) return
  const substituted = substituteVariables(cmd.command, config)
  exec(
    substituted,
    { cwd: config.workingDir, shell: config.shell, env: { ...process.env, ...config.env } },
    (error) => {
      appendActivity(
        { projectId, timestamp: Date.now(), changedPath, commandLabel: cmd.label, success: !error },
        win
      )
    }
  )
}

export function startWatching(win: BrowserWindow, projectId: string): void {
  if (watchers.has(projectId)) return
  const config = getProject(projectId)
  if (!config || !config.watchSync.enabled || config.watchSync.globs.length === 0) return

  // § path validation — starting a watcher against a missing folder is
  // exactly the "before any action that uses the path" case; skip quietly
  // (one log line, not an error dialog) rather than let chokidar spam
  // ENOENT events at the missing root.
  const validation = validateProjectPath(config.workingDir)
  if (!validation.valid) {
    console.warn(`[watch-sync] not starting for project "${config.name}": ${validation.reason}`)
    return
  }

  const debounceMs = config.watchSync.debounceMs || 1500
  const watcher = chokidar.watch(config.watchSync.globs, {
    cwd: config.workingDir,
    ignored: config.watchSync.ignore,
    ignoreInitial: true
  })

  watcher.on('all', (_event, changedPath) => {
    const existing = debounceTimers.get(projectId)
    if (existing) clearTimeout(existing)
    debounceTimers.set(
      projectId,
      setTimeout(() => {
        debounceTimers.delete(projectId)
        triggerSync(projectId, changedPath, win)
      }, debounceMs)
    )
  })

  // The watched root itself disappearing (renamed/deleted while watching)
  // surfaces here — stop silently instead of leaving a dead watcher
  // retrying forever or spamming errors.
  watcher.on('error', (err) => {
    console.warn(`[watch-sync] stopped for project "${config.name}": ${err instanceof Error ? err.message : err}`)
    stopWatching(projectId)
  })

  watchers.set(projectId, watcher)
}

export function stopWatching(projectId: string): void {
  const watcher = watchers.get(projectId)
  if (watcher) {
    watcher.close()
    watchers.delete(projectId)
  }
  const timer = debounceTimers.get(projectId)
  if (timer) {
    clearTimeout(timer)
    debounceTimers.delete(projectId)
  }
}

export function setWatchSyncEnabled(win: BrowserWindow, projectId: string, enabled: boolean): void {
  const config = getProject(projectId)
  if (!config) return
  saveProject({ ...config, watchSync: { ...config.watchSync, enabled } })
  if (enabled) startWatching(win, projectId)
  else stopWatching(projectId)
}
