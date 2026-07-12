import type { JSX } from 'preact'
import { builtForVersion, isVersionMismatch } from '../versionCheck'

interface VersionMismatchBannerProps {
  serverVersion: string | null
}

// § API versioning (§7) — "fail loud, not weird": rather than a stale
// service-worker-cached bundle hitting a newer/older ShinShell and
// producing confusing one-off API failures, say plainly that the two are
// out of sync and offer the one-tap fix. Not dismissible — reload is the
// actual fix, not something to defer past.
export default function VersionMismatchBanner({ serverVersion }: VersionMismatchBannerProps): JSX.Element | null {
  if (!isVersionMismatch(serverVersion)) return null
  return (
    <div class="version-mismatch-banner">
      ShinShell Remote is out of date (built for v{builtForVersion()}, server is v{serverVersion}).
      <button onClick={() => location.reload()}>Reload</button>
    </div>
  )
}
