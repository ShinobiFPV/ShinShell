import type { JSX } from 'preact'

interface NavigatorStandalone extends Navigator {
  standalone?: boolean
}

/** True for Safari on iOS/iPadOS running as a plain browser tab — the one
 *  environment where push straight-up doesn't work at all (no Notification
 *  permission prompt, no PushManager), not "works but degraded." Excludes
 *  an already-installed Home Screen PWA (`navigator.standalone`, Safari's
 *  own non-standard flag) and every non-iOS browser. */
function needsHomeScreenInstall(): boolean {
  const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent)
  const isStandalone = (navigator as NavigatorStandalone).standalone === true
  return isIos && !isStandalone
}

// § housekeeping (§7) — "iOS install instructions inline": shown directly
// on the pairing screen (the first thing a new iOS user sees) rather than
// buried one tap deep in Settings, since without this step push is
// invisible-broken — no error, no prompt, it just never arrives.
export default function IosInstallBanner(): JSX.Element | null {
  if (!needsHomeScreenInstall()) return null
  return (
    <div class="ios-install-banner">
      📲 On iPhone/iPad, push notifications only work after adding this to your Home Screen: tap{' '}
      <strong>Share</strong> → <strong>Add to Home Screen</strong>, then open it from there.
    </div>
  )
}
