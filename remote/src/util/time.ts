// § Mission Control (§1) — compact "time-in-state" / "up X" formatting for
// project cards and the health footer. Deliberately coarse (one unit, no
// seconds past the first minute) — a card is a glance, not a stopwatch.
export function formatDuration(sinceMs: number): string {
  const totalSeconds = Math.max(0, Math.floor((Date.now() - sinceMs) / 1000))
  if (totalSeconds < 60) return `${totalSeconds}s`
  const totalMinutes = Math.floor(totalSeconds / 60)
  if (totalMinutes < 60) return `${totalMinutes}m`
  const totalHours = Math.floor(totalMinutes / 60)
  const remMinutes = totalMinutes % 60
  if (totalHours < 24) return remMinutes ? `${totalHours}h${remMinutes}m` : `${totalHours}h`
  const totalDays = Math.floor(totalHours / 24)
  return `${totalDays}d`
}
