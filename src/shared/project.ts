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

export interface RestoredTab {
  id: string
  cwd: string
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
