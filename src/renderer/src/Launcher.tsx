import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectConfig, ProjectValidation } from '../../shared/project'
import AdminBadge from './AdminBadge'
import EditProjectDialog from './EditProjectDialog'
import RemoteBadge from './RemoteBadge'
import RemoteSettingsPanel from './RemoteSettingsPanel'

const FOCUS_REVALIDATE_DEBOUNCE_MS = 300

export default function Launcher(): JSX.Element {
  const [projects, setProjects] = useState<ProjectConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [pathStatus, setPathStatus] = useState<Record<string, ProjectValidation>>({})
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null)
  const [remoteSettingsOpen, setRemoteSettingsOpen] = useState(false)
  const focusTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refresh = useCallback(async () => {
    const list = await window.shinshell.projects.list()
    setProjects(list)
    setLoading(false)
    const statuses = await Promise.all(list.map((p) => window.shinshell.projects.validate(p.id)))
    setPathStatus(Object.fromEntries(list.map((p, i) => [p.id, statuses[i]])))
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  // § re-check cheaply — a rename made while ShinShell is open (but not
  // focused on the launcher) surfaces next time you tab back to it. No
  // filesystem watchers on parent directories; a focus-triggered check
  // costs one existsSync per project and nothing while unfocused.
  useEffect(() => {
    const onFocus = (): void => {
      if (focusTimer.current) clearTimeout(focusTimer.current)
      focusTimer.current = setTimeout(refresh, FOCUS_REVALIDATE_DEBOUNCE_MS)
    }
    window.addEventListener('focus', onFocus)
    return () => {
      window.removeEventListener('focus', onFocus)
      if (focusTimer.current) clearTimeout(focusTimer.current)
    }
  }, [refresh])

  const openProject = (id: string): void => window.shinshell.window.openProject(id)

  const openFolder = useCallback(async () => {
    const created = await window.shinshell.projects.createFromFolder()
    if (!created) return
    await refresh()
    openProject(created.id)
  }, [refresh])

  const editingProject = projects.find((p) => p.id === editingProjectId) ?? null

  return (
    <div className="launcher">
      <div className="launcher-header">
        <h1>ShinShell</h1>
        <div className="launcher-header-actions">
          <AdminBadge />
          <RemoteBadge onClick={() => setRemoteSettingsOpen(true)} />
          <button className="btn-primary" onClick={openFolder}>
            + Open Project
          </button>
        </div>
      </div>

      {loading ? (
        <div className="launcher-loading">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="launcher-empty">No projects yet — click "Open Project" to add one.</div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => {
            const status = pathStatus[p.id]
            const broken = status && !status.valid
            return (
              <div key={p.id} className="project-card">
                <div className="project-card-accent" style={{ background: p.accentColor }} />
                <div className="project-card-body">
                  <div className="project-card-name-row">
                    <span className="project-card-name">{p.name}</span>
                    <button
                      className="project-card-edit"
                      onMouseDown={() => setEditingProjectId(p.id)}
                      title="Edit project details"
                    >
                      ⋯
                    </button>
                  </div>
                  {broken ? (
                    <div className="project-card-broken">
                      <span className="project-card-warning" title={status.reason}>
                        ⚠ Folder not found: {p.workingDir}
                      </span>
                      <button className="project-card-fix" onMouseDown={() => setEditingProjectId(p.id)}>
                        Fix path…
                      </button>
                    </div>
                  ) : (
                    <button className="project-card-open" onClick={() => openProject(p.id)}>
                      {p.workingDir}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {editingProject && (
        <EditProjectDialog
          project={editingProject}
          onClose={() => setEditingProjectId(null)}
          onSaved={() => refresh()}
        />
      )}

      {remoteSettingsOpen && <RemoteSettingsPanel onClose={() => setRemoteSettingsOpen(false)} />}
    </div>
  )
}
