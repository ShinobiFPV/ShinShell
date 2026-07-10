import { app } from 'electron'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join, basename } from 'path'
import type { ProjectConfig, ProjectRestoreState } from '../shared/project'
import { emptyRestoreState } from '../shared/project'

const projectsDir = (): string => join(app.getPath('userData'), 'projects')

// Seed configs (from Phase 0 discovery) ship alongside the app: unpacked
// under resources/ in dev, copied to process.resourcesPath when packaged
// (see package.json build.extraResources).
const seedDir = (): string =>
  app.isPackaged
    ? join(process.resourcesPath, 'default-projects')
    : join(app.getAppPath(), 'resources', 'default-projects')

function ensureSeeded(): void {
  const dir = projectsDir()
  mkdirSync(dir, { recursive: true })
  if (readdirSync(dir).some((f) => f.endsWith('.json'))) return

  const seed = seedDir()
  if (!existsSync(seed)) return
  for (const file of readdirSync(seed).filter((f) => f.endsWith('.json'))) {
    writeFileSync(join(dir, file), readFileSync(join(seed, file)))
  }
}

// Seed drift: ensureSeeded() above only ever populates a brand-new (empty)
// projects dir, so a field added to a default command later (e.g. this
// project's own `dangerous: true` on imq2's deploy-restart) never reaches an
// install that already has that project's config on disk — it just keeps
// getting re-saved in its old shape every time restore state is persisted.
// This backfills any command field present in the seed but missing from the
// saved copy, matched by command id. It never overwrites a field the user's
// copy already has — including an explicit override like `"dangerous": false`
// — and never adds a command the seed has that the user's config doesn't;
// that's a bigger call (re-adding something the user may have deleted on
// purpose) than "propagate a schema addition."
function migrateFromSeed(config: ProjectConfig): ProjectConfig {
  const seedPath = join(seedDir(), `${config.id}.json`)
  if (!existsSync(seedPath)) return config

  let seed: ProjectConfig
  try {
    seed = JSON.parse(readFileSync(seedPath, 'utf-8')) as ProjectConfig
  } catch {
    return config
  }

  const seedCommandsById = new Map(seed.commands.map((c) => [c.id, c]))
  let changed = false
  const commands = config.commands.map((cmd) => {
    const seedCmd = seedCommandsById.get(cmd.id)
    if (!seedCmd) return cmd
    const merged = { ...seedCmd, ...cmd }
    if (Object.keys(merged).length !== Object.keys(cmd).length) changed = true
    return merged
  })

  return changed ? { ...config, commands } : config
}

function loadProjectFile(path: string): ProjectConfig {
  const config = JSON.parse(readFileSync(path, 'utf-8')) as ProjectConfig
  const migrated = migrateFromSeed(config)
  if (migrated !== config) saveProject(migrated)
  return migrated
}

export function listProjects(): ProjectConfig[] {
  ensureSeeded()
  const dir = projectsDir()
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => loadProjectFile(join(dir, f)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getProject(id: string): ProjectConfig | undefined {
  const path = join(projectsDir(), `${id}.json`)
  if (!existsSync(path)) return undefined
  return loadProjectFile(path)
}

export function saveProject(config: ProjectConfig): void {
  mkdirSync(projectsDir(), { recursive: true })
  writeFileSync(join(projectsDir(), `${config.id}.json`), JSON.stringify(config, null, 2))
}

export function saveProjectRestoreState(id: string, restore: ProjectRestoreState): void {
  const config = getProject(id)
  if (!config) return
  saveProject({ ...config, restore })
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'project'
  )
}

export function createProjectFromFolder(folderPath: string, accentColor: string): ProjectConfig {
  const name = basename(folderPath)
  let id = slugify(name)
  let suffix = 2
  while (getProject(id)) {
    id = `${slugify(name)}-${suffix}`
    suffix += 1
  }

  const config: ProjectConfig = {
    id,
    name,
    accentColor,
    workingDir: folderPath,
    shell: 'powershell.exe',
    env: {},
    targets: [],
    commands: [],
    watchSync: { enabled: false, globs: [], ignore: [], onChange: '', debounceMs: 1500 },
    ports: [],
    restore: emptyRestoreState()
  }
  saveProject(config)
  return config
}
