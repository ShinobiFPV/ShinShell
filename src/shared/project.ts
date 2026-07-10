// Project config schema — matches SHINSHELL_SPEC.md §7 exactly.

export interface ProjectTarget {
  id: string
  label: string
  host: string
  user: string
  port: number
  healthCheck: boolean
}

export type CommandRunIn = 'new-tab' | 'active-terminal' | 'background'

export interface ProjectCommand {
  id: string
  label: string
  command: string
  hotkey?: string
  runIn: CommandRunIn
  /** UX2 — arm-to-confirm: doesn't fire on the first hotkey press/click, only
   *  on a second one within the confirm window. See ProjectWindow.tsx's
   *  `requestConfirm`. */
  dangerous?: boolean
}

export interface WatchSyncConfig {
  enabled: boolean
  globs: string[]
  ignore: string[]
  onChange: string
  debounceMs: number
}

// Tab kinds within a project window (§4): terminal + claude-code are both
// terminal-pane-tree tabs (claude-code is a preset that auto-types `claude`
// on spawn); claude-chat is a WebContentsView; editor/scratchpad are Monaco;
// log-tail/deploy/ports are the M6 pipeline features (§6.6/§6.7/§6.8).
export type TabKind =
  | 'terminal'
  | 'claude-code'
  | 'claude-chat'
  | 'editor'
  | 'scratchpad'
  | 'log-tail'
  | 'deploy'
  | 'ports'

export interface RestoredTab {
  id: string
  kind: TabKind
  cwd?: string // terminal / claude-code
  filePath?: string // editor (absent/null = unsaved new file)
  commandId?: string // log-tail — which project command it's tailing
}

export interface ProjectRestoreState {
  tabs: RestoredTab[]
  activeTabId: string | null
}

export interface ProjectConfig {
  id: string
  name: string
  accentColor: string
  workingDir: string
  shell: string
  env: Record<string, string>
  targets: ProjectTarget[]
  commands: ProjectCommand[]
  watchSync: WatchSyncConfig
  ports: number[]
  restore: ProjectRestoreState
  /** Git remote of workingDir as of the last successful open — used to rank
   *  "did you mean?" rename-recovery candidates when the folder goes missing.
   *  Never cleared once set; a later open with no readable remote just
   *  leaves the last-known value in place. */
  lastKnownGitRemote?: string
}

export function emptyRestoreState(): ProjectRestoreState {
  return { tabs: [], activeTabId: null }
}

/** Path-validation result for a project's workingDir (§ path validation). */
export interface ProjectValidation {
  valid: boolean
  reason?: string
}

/** A candidate replacement folder offered when a project's workingDir is
 *  missing, ranked by how it was matched. */
export interface PathCandidate {
  path: string
  reason: 'git-remote' | 'name-match' | 'recent'
}

/** Payload for editing a project's details — deliberately excludes `id`
 *  (keys the config filename + restore state) and the command/target/
 *  watchSync/ports/restore machinery, which the edit dialog doesn't touch. */
export interface ProjectUpdatePayload {
  id: string
  name: string
  accentColor: string
  workingDir: string
  shell: string
  env: Record<string, string>
}
