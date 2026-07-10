import { existsSync, readdirSync, readFileSync, statSync } from 'fs'
import { basename, dirname, join } from 'path'
import type { PathCandidate, ProjectValidation } from '../shared/project'

// A failed check must never throw — every path here is wrapped so a
// permissions error or a race (folder vanishes mid-stat) degrades to
// "invalid" instead of crashing whatever called it (pty spawn, watch-sync,
// app launch, ...).
export function validateProjectPath(workingDir: string): ProjectValidation {
  try {
    if (!workingDir) return { valid: false, reason: 'No folder configured' }
    if (!existsSync(workingDir)) return { valid: false, reason: `Folder not found: ${workingDir}` }
    if (!statSync(workingDir).isDirectory()) return { valid: false, reason: `Not a folder: ${workingDir}` }
    return { valid: true }
  } catch (err) {
    return { valid: false, reason: err instanceof Error ? err.message : 'Unknown path error' }
  }
}

export function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory()
  } catch {
    return false
  }
}

/** Reads `<dir>/.git/config` directly rather than shelling out to git — this
 *  gets called once per candidate folder while scanning for rename
 *  recovery, and a config-file read is both faster and doesn't require git
 *  on PATH. Returns null for anything that isn't a git repo (or is
 *  unreadable), never throws. */
export function readGitRemote(dir: string): string | null {
  try {
    const configPath = join(dir, '.git', 'config')
    if (!existsSync(configPath)) return null
    const content = readFileSync(configPath, 'utf-8')
    const match = /\[remote "origin"\][^[]*?url\s*=\s*(.+)/i.exec(content)
    return match ? match[1].trim() : null
  } catch {
    return null
  }
}

function normalizeRemote(url: string): string {
  return url.trim().toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '')
}

function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '')
}

// Dice coefficient over character bigrams — a small, dependency-free fuzzy
// match that's plenty good enough to rank "imq2-old" / "imq2-renamed"
// against "imq2" without pulling in a string-distance package.
function nameSimilarity(a: string, b: string): number {
  const na = normalizeName(a)
  const nb = normalizeName(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) return 0.85

  const bigrams = (s: string): string[] => {
    const out: string[] = []
    for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2))
    return out
  }
  const ba = bigrams(na)
  const bb = bigrams(nb)
  if (ba.length === 0 || bb.length === 0) return 0

  const remaining = new Map<string, number>()
  for (const g of bb) remaining.set(g, (remaining.get(g) ?? 0) + 1)
  let overlap = 0
  for (const g of ba) {
    const count = remaining.get(g) ?? 0
    if (count > 0) {
      overlap++
      remaining.set(g, count - 1)
    }
  }
  return (2 * overlap) / (ba.length + bb.length)
}

const NAME_MATCH_THRESHOLD = 0.5

/** Scans the missing path's parent directory for "did you mean?" candidates
 *  (§ smart recovery), ranked: exact git remote match > name similarity >
 *  most recently modified. Never throws — an unreadable parent just yields
 *  no suggestions rather than blocking the fix-path dialog. */
export function findRenameCandidates(
  oldWorkingDir: string,
  lastKnownGitRemote: string | undefined,
  limit = 3
): PathCandidate[] {
  const parent = dirname(oldWorkingDir)
  if (!isDirectory(parent)) return []
  const oldName = basename(oldWorkingDir)
  const normalizedRemote = lastKnownGitRemote ? normalizeRemote(lastKnownGitRemote) : null

  let entries: string[]
  try {
    entries = readdirSync(parent, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
  } catch {
    return []
  }

  const scored = entries.map((name) => {
    const fullPath = join(parent, name)
    const remote = normalizedRemote ? readGitRemote(fullPath) : null
    const gitMatch = !!normalizedRemote && !!remote && normalizeRemote(remote) === normalizedRemote
    const similarity = nameSimilarity(name, oldName)
    let mtime = 0
    try {
      mtime = statSync(fullPath).mtimeMs
    } catch {
      // leave mtime at 0 — worst-ranked, not fatal
    }
    return { fullPath, gitMatch, similarity, mtime }
  })

  scored.sort((a, b) => {
    if (a.gitMatch !== b.gitMatch) return a.gitMatch ? -1 : 1
    if (a.similarity !== b.similarity) return b.similarity - a.similarity
    return b.mtime - a.mtime
  })

  return scored.slice(0, limit).map((s) => ({
    path: s.fullPath,
    reason: s.gitMatch ? 'git-remote' : s.similarity >= NAME_MATCH_THRESHOLD ? 'name-match' : 'recent'
  }))
}
