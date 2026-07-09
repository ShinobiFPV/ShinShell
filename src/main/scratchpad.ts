import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

const scratchpadDir = (): string => join(app.getPath('userData'), 'scratchpads')
const scratchpadPath = (projectId: string): string => join(scratchpadDir(), `${projectId}.md`)

export function loadScratchpad(projectId: string): string {
  const path = scratchpadPath(projectId)
  if (!existsSync(path)) return ''
  return readFileSync(path, 'utf-8')
}

export function saveScratchpad(projectId: string, content: string): void {
  mkdirSync(scratchpadDir(), { recursive: true })
  writeFileSync(scratchpadPath(projectId), content, 'utf-8')
}
