import { execFile } from 'child_process'
import { promisify } from 'util'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

const SCHEDULED_TASK_NAME = 'ShinShell'

/** Windows only — checks the current process's token, not just "is an admin account." */
export async function isElevated(): Promise<boolean> {
  if (process.platform !== 'win32') return false
  try {
    const { stdout } = await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      '([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)'
    ])
    return stdout.trim().toLowerCase() === 'true'
  } catch {
    return false
  }
}

async function taskExists(): Promise<boolean> {
  try {
    await execFileAsync('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Get-ScheduledTask -TaskName '${SCHEDULED_TASK_NAME}' -ErrorAction Stop | Out-Null`
    ])
    return true
  } catch {
    return false
  }
}

/** Registers (or repairs) the "ShinShell" scheduled task so future launches via
 *  schtasks /run get RunLevel=Highest with no UAC prompt. Registering the task
 *  itself requires admin rights — call this only from an already-elevated
 *  process (e.g. after a self-repair relaunch, or from the installer). */
export async function registerScheduledTask(): Promise<void> {
  const exePath = app.getPath('exe')
  const script = `
$action = New-ScheduledTaskAction -Execute '${exePath.replace(/'/g, "''")}'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -RunLevel Highest -LogonType Interactive
Register-ScheduledTask -TaskName '${SCHEDULED_TASK_NAME}' -Action $action -Principal $principal -Force | Out-Null
`.trim()

  await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script])
}

/** Called once at startup. If we're already elevated (e.g. the user happened
 *  to launch from an elevated shell, or the installer's own registration
 *  silently failed) but the scheduled task is missing or broken, fix it
 *  quietly — no prompt needed since we already have the rights. If we're
 *  NOT elevated, do nothing here; the ADMIN badge (§5.4) surfaces that and
 *  lets the user trigger repairAndRelaunch() themselves. */
export async function ensureScheduledTaskIfElevated(): Promise<void> {
  if (!(await isElevated())) return
  if (await taskExists()) return
  try {
    await registerScheduledTask()
  } catch {
    // Non-fatal — worst case the ADMIN badge won't show elevated on the
    // *next* unelevated launch either, and the user can hit Repair then.
  }
}

/** Self-repair: one elevated PowerShell invocation (one UAC prompt) that
 *  re-registers the scheduled task AND launches the app, then this
 *  (unelevated) instance quits. Every launch after this uses the repaired
 *  task and sees no further prompts. */
export function repairAndRelaunch(): void {
  const exePath = app.getPath('exe').replace(/'/g, "''")
  const inner = `
$action = New-ScheduledTaskAction -Execute '${exePath}'
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\\$env:USERNAME" -RunLevel Highest -LogonType Interactive
Register-ScheduledTask -TaskName '${SCHEDULED_TASK_NAME}' -Action $action -Principal $principal -Force | Out-Null
Start-Process -FilePath '${exePath}'
`.trim()
  const encoded = Buffer.from(inner, 'utf16le').toString('base64')

  execFile('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    `Start-Process powershell.exe -Verb RunAs -ArgumentList '-NoProfile','-EncodedCommand','${encoded}'`
  ])
  app.quit()
}
