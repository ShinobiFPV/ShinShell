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
}

export function emptyRestoreState(): ProjectRestoreState {
  return { tabs: [], activeTabId: null }
}
