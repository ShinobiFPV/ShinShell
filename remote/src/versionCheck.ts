// § API versioning (§7) — the PWA bundle running right now was built and
// packaged alongside one specific ShinShell release (build:remote runs as
// part of that release's own build). If the service worker is still
// serving an old cached bundle after ShinShell auto-updated itself, the two
// versions drift apart — this compares the two so the app can say so
// loudly instead of the drift manifesting as confusing one-off API
// failures.
export function builtForVersion(): string {
  return __SHINSHELL_VERSION__
}

export function isVersionMismatch(serverVersion: string | null | undefined): boolean {
  if (!serverVersion) return false
  const built = builtForVersion()
  if (built === 'dev') return false // PWA-only dev iteration — not a real release to compare against
  return built !== serverVersion
}
