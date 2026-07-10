interface ArmedCommandBannerProps {
  summary: string
}

// §UX2 — shown while a dangerous command is armed (first trigger, waiting on
// a second one within the confirm window). Pulses in the project's accent
// color so it reads as "this is the loaded, about-to-fire thing."
export default function ArmedCommandBanner({ summary }: ArmedCommandBannerProps): JSX.Element {
  return (
    <div className="armed-command-banner">
      <span className="armed-command-summary">{summary}</span>
      <span className="armed-command-hint">press again to confirm</span>
    </div>
  )
}
