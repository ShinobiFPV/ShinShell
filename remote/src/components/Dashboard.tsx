import type { JSX } from 'preact'
import type { RemoteClosedProject, RemoteHealth, RemoteProject } from '../ws/protocol'
import { formatDuration } from '../util/time'
import DeployButton from './DeployButton'

interface DashboardProps {
  projects: RemoteProject[]
  health: RemoteHealth | null
  onSelectProject: (projectId: string) => void
  allowDeploy: boolean
  onRunDeployCommand: (projectId: string, commandId: string) => void
  /** § remote project control — off by default; gates both the closed-
   *  projects list below and the per-card open/close buttons. */
  allowProjectControl: boolean
  closedProjects: RemoteClosedProject[]
  onOpenProject: (projectId: string) => void
  onCloseProject: (projectId: string) => void
  /** § connection UX (§6) — true whenever the WS isn't live, so the cards
   *  below might be showing a cached snapshot rather than this instant's
   *  truth. */
  stale: boolean
  /** epoch ms of the last successful GET /api/projects — from a live fetch,
   *  or (on a cold offline launch) the cached snapshot's own timestamp. */
  dataAsOf: number | null
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const STATE_LABEL: Record<RemoteProject['state'], string> = {
  waiting: 'WAITING',
  busy: 'BUSY',
  idle: 'IDLE'
}

const SSH_LABEL: Record<string, string> = {
  up: 'SSH ok',
  down: 'SSH down',
  checking: 'SSH checking…',
  unknown: 'SSH unknown'
}

// § Mission Control (§1) — the app's home screen: one card per project open
// on ShinShell, colored in that project's accent, so a glance (ideally just
// the lock-screen notification, but this is what it opens into) is often
// enough to decide whether to actually pick up the phone. Polled from
// GET /api/projects/​/api/health at app.tsx's PROJECTS_POLL_MS — no live WS
// subscription per card (see SessionList's note on why that'd be wasteful
// for chips nobody's actively viewing).
export default function Dashboard({
  projects,
  health,
  onSelectProject,
  allowDeploy,
  onRunDeployCommand,
  allowProjectControl,
  closedProjects,
  onOpenProject,
  onCloseProject,
  stale,
  dataAsOf
}: DashboardProps): JSX.Element {
  return (
    <div class="dashboard">
      {stale && dataAsOf !== null && (
        <div class="dashboard-stale-badge">Showing cached data from {formatClock(dataAsOf)}</div>
      )}
      <div class="dashboard-grid">
        {projects.length === 0 && (
          <div class="dashboard-empty">
            {stale && dataAsOf === null
              ? 'ShinShell unreachable and nothing cached yet.'
              : 'No projects open on ShinShell right now.'}
          </div>
        )}
        {projects.map((p) => (
          // A plain div, not a <button> — § remote deploy (§5) nests real
          // <button> deploy actions inside, and a <button> can't legally
          // contain another <button>. Card-tap-to-open still works via
          // onClick; the deploy buttons stopPropagation to opt out of it.
          <div
            key={p.id}
            class="project-card"
            style={{ '--card-accent': p.accentColor } as Record<string, string>}
            onClick={() => onSelectProject(p.id)}
          >
            <div class="project-card-header">
              <span class="project-card-name">{p.name}</span>
              {allowProjectControl && (
                <button
                  type="button"
                  class="project-card-close-btn"
                  title={`Close ${p.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    onCloseProject(p.id)
                  }}
                >
                  Close
                </button>
              )}
              <span class={`project-card-state-dot project-card-state-${p.state}`} />
            </div>
            <div class="project-card-state-row">
              <span class={`project-card-state-label project-card-state-label-${p.state}`}>
                {STATE_LABEL[p.state]}
              </span>
              <span class="project-card-time">{formatDuration(p.stateSince)}</span>
            </div>
            <div class="project-card-lines">
              {p.lastLines.length === 0 ? (
                <span class="project-card-lines-empty">No Claude Code session</span>
              ) : (
                p.lastLines.map((line, i) => (
                  <div class="project-card-line" key={i}>
                    {line}
                  </div>
                ))
              )}
            </div>
            <div class="project-card-footer">
              <span class={`ssh-dot ssh-dot-${p.sshHealth.state}`} />
              <span class="project-card-ssh-label">{SSH_LABEL[p.sshHealth.state]}</span>
            </div>
            {allowDeploy && p.deployCommands && p.deployCommands.length > 0 && (
              <div class="project-card-deploy-row">
                {p.deployCommands.map((cmd) => (
                  <DeployButton
                    key={cmd.id}
                    command={cmd}
                    accentColor={p.accentColor}
                    onRun={(commandId) => onRunDeployCommand(p.id, commandId)}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
      {allowProjectControl && closedProjects.length > 0 && (
        <div class="dashboard-closed-section">
          <div class="dashboard-closed-heading">Closed</div>
          <div class="dashboard-closed-list">
            {closedProjects.map((p) => (
              <div
                key={p.id}
                class="closed-project-row"
                style={{ '--card-accent': p.accentColor } as Record<string, string>}
              >
                <span class="closed-project-name">{p.name}</span>
                <button type="button" class="closed-project-open-btn" onClick={() => onOpenProject(p.id)}>
                  Open
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <div class="dashboard-footer">
        {health ? (
          <span>
            ShinShell v{health.version} · up {formatDuration(Date.now() - health.uptime * 1000)} ·{' '}
            {health.hostname}
          </span>
        ) : (
          <span class="dashboard-footer-offline">ShinShell unreachable</span>
        )}
      </div>
    </div>
  )
}
