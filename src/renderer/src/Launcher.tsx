import { useCallback, useEffect, useState } from 'react'
import type { ProjectConfig } from '../../shared/project'

export default function Launcher(): JSX.Element {
  const [projects, setProjects] = useState<ProjectConfig[]>([])
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    setProjects(await window.shinshell.projects.list())
    setLoading(false)
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  const openProject = (id: string): void => window.shinshell.window.openProject(id)

  const openFolder = useCallback(async () => {
    const created = await window.shinshell.projects.createFromFolder()
    if (!created) return
    await refresh()
    openProject(created.id)
  }, [refresh])

  return (
    <div className="launcher">
      <div className="launcher-header">
        <h1>ShinShell</h1>
        <button className="btn-primary" onClick={openFolder}>
          + Open Project
        </button>
      </div>

      {loading ? (
        <div className="launcher-loading">Loading projects…</div>
      ) : projects.length === 0 ? (
        <div className="launcher-empty">No projects yet — click "Open Project" to add one.</div>
      ) : (
        <div className="project-grid">
          {projects.map((p) => (
            <button key={p.id} className="project-card" onClick={() => openProject(p.id)}>
              <div className="project-card-accent" style={{ background: p.accentColor }} />
              <div className="project-card-body">
                <div className="project-card-name">{p.name}</div>
                <div className="project-card-dir">{p.workingDir}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
