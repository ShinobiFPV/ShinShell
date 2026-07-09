import { dialog, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'fs'

export function readFile(path: string): string {
  return readFileSync(path, 'utf-8')
}

export function writeFile(path: string, content: string): void {
  writeFileSync(path, content, 'utf-8')
}

export async function showOpenFileDialog(
  win: BrowserWindow | null,
  defaultPath?: string
): Promise<string | null> {
  const options: Electron.OpenDialogOptions = {
    properties: ['openFile'],
    defaultPath,
    title: 'Open File'
  }
  const result = await (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options))
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}

export async function showSaveFileDialog(
  win: BrowserWindow | null,
  defaultPath?: string
): Promise<string | null> {
  const options: Electron.SaveDialogOptions = { defaultPath, title: 'Save File' }
  const result = await (win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options))
  if (result.canceled || !result.filePath) return null
  return result.filePath
}
