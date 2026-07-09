import { exec } from 'child_process'
import type { BackgroundCommandOptions } from '../shared/ipc'

// runIn: "background" (§7/§8) — fired and forgotten for now; there's no
// output surface for background jobs yet (that's the deploy tab, §6.7/M6).
// Logged to the main process console so it's at least visible in DevTools
// during development.
export function runBackgroundCommand(opts: BackgroundCommandOptions): void {
  exec(
    opts.command,
    { cwd: opts.cwd, shell: opts.shell, env: { ...process.env, ...opts.env } },
    (error, stdout, stderr) => {
      if (error) {
        console.error(`[background command] "${opts.command}" failed:`, error.message)
        return
      }
      if (stdout) console.log(`[background command] "${opts.command}" stdout:\n${stdout}`)
      if (stderr) console.warn(`[background command] "${opts.command}" stderr:\n${stderr}`)
    }
  )
}
