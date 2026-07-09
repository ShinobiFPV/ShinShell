import { execFile } from 'child_process'
import { promisify } from 'util'
import type { GitStatus } from '../shared/ipc'

const execFileAsync = promisify(execFile)

// §6.12 — branch name + dirty indicator per project. Returns null for
// projects whose workingDir isn't a git repo (or git isn't on PATH), so the
// tab strip can just hide the indicator rather than show an error.
export async function getGitStatus(workingDir: string): Promise<GitStatus | null> {
  try {
    const { stdout: branchOut } = await execFileAsync(
      'git',
      ['rev-parse', '--abbrev-ref', 'HEAD'],
      { cwd: workingDir }
    )
    const branch = branchOut.trim()
    if (!branch) return null

    const { stdout: statusOut } = await execFileAsync('git', ['status', '--porcelain'], {
      cwd: workingDir
    })
    return { branch, dirty: statusOut.trim().length > 0 }
  } catch {
    return null
  }
}
