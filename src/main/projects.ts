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

export function listProjects(): ProjectConfig[] {
  ensureSeeded()
  const dir = projectsDir()
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf-8')) as ProjectConfig)
    .sort((a, b) => a.name.localeCompare(b.name))
}

export function getProject(id: string): ProjectConfig | undefined {
  const path = join(projectsDir(), `${id}.json`)
  if (!existsSync(path)) return undefined
  return JSON.parse(readFileSync(path, 'utf-8')) as ProjectConfig
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
