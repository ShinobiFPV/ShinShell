// § ShinShell Remote — Tailscale detection + HTTPS cert issuance/renewal.
// Follows the execFile+promisify shelling-out pattern already used by
// gitStatus.ts/ports.ts/elevation.ts.
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'

const execFileAsync = promisify(execFile)

const DEFAULT_TAILSCALE_EXE = 'C:\\Program Files\\Tailscale\\tailscale.exe'

async function resolveTailscaleExe(): Promise<string | null> {
  try {
    await execFileAsync('tailscale', ['version'])
    return 'tailscale'
  } catch {
    return existsSync(DEFAULT_TAILSCALE_EXE) ? DEFAULT_TAILSCALE_EXE : null
  }
}

export interface TailscaleSelf {
  exe: string
  ip: string
  dnsName: string
}

interface TailscaleStatusJson {
  BackendState?: string
  Self?: { TailscaleIPs?: string[] }
  CertDomains?: string[]
}

/** Null if Tailscale isn't installed, isn't running, or hasn't finished
 *  logging in — the caller (remote/server.ts) treats any of these as "refuse
 *  to start Remote" per the plan's core security requirement. */
export async function getTailscaleSelf(): Promise<TailscaleSelf | null> {
  const exe = await resolveTailscaleExe()
  if (!exe) return null
  try {
    const { stdout } = await execFileAsync(exe, ['status', '--json'], {
      maxBuffer: 10 * 1024 * 1024
    })
    const status = JSON.parse(stdout) as TailscaleStatusJson
    if (status.BackendState !== 'Running') return null
    const ip = status.Self?.TailscaleIPs?.find((addr) => !addr.includes(':'))
    // CertDomains is the pre-cleaned name `tailscale cert` itself expects
    // (Self.DNSName has a trailing dot and isn't guaranteed to match a
    // cert-eligible domain) — prefer it.
    const dnsName = status.CertDomains?.[0]
    if (!ip || !dnsName) return null
    return { exe, ip, dnsName }
  } catch {
    return null
  }
}

function certDir(): string {
  return join(app.getPath('userData'), 'certs')
}

export interface CertPaths {
  certPath: string
  keyPath: string
}

/** Idempotent — `tailscale cert` returns instantly from local cache if the
 *  cert still has enough validity, or transparently re-issues near expiry.
 *  Requires "HTTPS Certificates" enabled for the tailnet in the admin
 *  console; a failure here almost always means that's off. */
export async function issueCert(exe: string, dnsName: string): Promise<CertPaths> {
  const dir = certDir()
  mkdirSync(dir, { recursive: true })
  const certPath = join(dir, `${dnsName}.crt`)
  const keyPath = join(dir, `${dnsName}.key`)
  await execFileAsync(exe, ['cert', `--cert-file=${certPath}`, `--key-file=${keyPath}`, dnsName])
  return { certPath, keyPath }
}
