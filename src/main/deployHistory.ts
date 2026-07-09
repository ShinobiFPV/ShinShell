import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { DeployRun } from '../shared/ipc'

const MAX_RUNS = 20

const historyDir = (): string => join(app.getPath('userData'), 'deploy-history')
const historyPath = (projectId: string): string => join(historyDir(), `${projectId}.json`)

export function getDeployHistory(projectId: string): DeployRun[] {
  const path = historyPath(projectId)
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf-8')) as DeployRun[]
  } catch {
    return []
  }
}

export function appendDeployRun(projectId: string, run: DeployRun): void {
  const runs = [run, ...getDeployHistory(projectId)].slice(0, MAX_RUNS)
  mkdirSync(historyDir(), { recursive: true })
  writeFileSync(historyPath(projectId), JSON.stringify(runs, null, 2), 'utf-8')
}
