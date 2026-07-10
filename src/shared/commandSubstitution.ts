import type { ProjectCommand, ProjectConfig, ProjectTarget } from './project'

// Pull the first {targets.<id>.…} reference out of a command string and
// resolve it against the project's targets — used by the arm-to-confirm
// summary (§UX2) and the hotkey sidebar's "target" column (§UX4).
export function findCommandTarget(cmd: ProjectCommand, config: ProjectConfig): ProjectTarget | undefined {
  const match = /\{targets\.([\w-]+)\./.exec(cmd.command)
  return match ? config.targets.find((t) => t.id === match[1]) : undefined
}

// {workingDir}, {env.NAME}, {targets.<id>.<field>} substitution — spec §7.
export function substituteVariables(command: string, config: ProjectConfig): string {
  return command
    .replace(/\{workingDir\}/g, config.workingDir)
    .replace(/\{env\.([A-Za-z0-9_]+)\}/g, (_match, name: string) => config.env[name] ?? '')
    .replace(/\{targets\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+)\}/g, (_match, id: string, field: string) => {
      const target = config.targets.find((t) => t.id === id)
      if (!target) return ''
      const value = (target as unknown as Record<string, unknown>)[field]
      return value === undefined || value === null ? '' : String(value)
    })
}
