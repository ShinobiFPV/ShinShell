import { useCallback, useEffect, useRef, useState } from 'react'
import type { ProjectConfig, PathCandidate, ProjectUpdatePayload } from '../../shared/project'

interface EditProjectDialogProps {
  project: ProjectConfig
  onClose: () => void
  onSaved: (updated: ProjectConfig) => void
}

// Same deterministic accent palette index.ts hands out to freshly-imported
// projects — reused here as swatch choices rather than inventing a second
// palette for the edit dialog.
const ACCENT_SWATCHES = ['#33FF66', '#FF8000', '#E10600', '#00B8D9', '#B14EFF', '#FFD400']

const PATH_CHECK_DEBOUNCE_MS = 300

const REASON_LABEL: Record<PathCandidate['reason'], string> = {
  'git-remote': 'git remote matches',
  'name-match': 'similar name',
  recent: 'recently modified'
}

interface EnvRow {
  key: string
  value: string
}

function envToRows(env: Record<string, string>): EnvRow[] {
  return Object.entries(env).map(([key, value]) => ({ key, value }))
}

function rowsToEnv(rows: EnvRow[]): Record<string, string> {
  const env: Record<string, string> = {}
  for (const row of rows) {
    const key = row.key.trim()
    if (key) env[key] = row.value
  }
  return env
}

// §2/§3 — editable project details, plus (when the current path doesn't
// resolve) up to 3 "did you mean?" rename-recovery suggestions ranked by
// projectValidation.ts on the main side.
export default function EditProjectDialog({ project, onClose, onSaved }: EditProjectDialogProps): JSX.Element {
  const [name, setName] = useState(project.name)
  const [accentColor, setAccentColor] = useState(project.accentColor)
  const [workingDir, setWorkingDir] = useState(project.workingDir)
  const [shell, setShell] = useState(project.shell)
  const [envRows, setEnvRows] = useState<EnvRow[]>(envToRows(project.env))
  const [pathValid, setPathValid] = useState<boolean | null>(null)
  const [checking, setChecking] = useState(true)
  const [suggestions, setSuggestions] = useState<PathCandidate[]>([])
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Live path validation, debounced — checks whatever's currently typed,
  // not just the path the project was configured with.
  useEffect(() => {
    setChecking(true)
    if (checkTimer.current) clearTimeout(checkTimer.current)
    checkTimer.current = setTimeout(async () => {
      const valid = await window.shinshell.files.pathIsDirectory(workingDir)
      setPathValid(valid)
      setChecking(false)
    }, PATH_CHECK_DEBOUNCE_MS)
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current)
    }
  }, [workingDir])

  // Suggestions only make sense against the project's original (broken)
  // path — fetched once, not re-run as the user types a fix.
  useEffect(() => {
    window.shinshell.projects.suggestFixes(project.id).then(setSuggestions)
  }, [project.id])

  const pickFolder = useCallback(async () => {
    const picked = await window.shinshell.files.showOpenFolderDialog(workingDir)
    if (picked) setWorkingDir(picked)
  }, [workingDir])

  const save = useCallback(
    async (overrideWorkingDir?: string) => {
      const finalWorkingDir = overrideWorkingDir ?? workingDir
      setSaving(true)
      setSaveError(null)
      try {
        const payload: ProjectUpdatePayload = {
          id: project.id,
          name,
          accentColor,
          workingDir: finalWorkingDir,
          shell,
          env: rowsToEnv(envRows)
        }
        const updated = await window.shinshell.projects.update(payload)
        onSaved(updated)
        onClose()
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Save failed')
        setSaving(false)
      }
    },
    [project.id, name, accentColor, shell, envRows, workingDir, onSaved, onClose]
  )

  // §3 — "a rename in place is a one-click fix": apply the suggestion AND
  // save immediately, rather than just filling the field and making the
  // user click Save again.
  const applySuggestion = useCallback(
    (candidate: PathCandidate) => {
      setWorkingDir(candidate.path)
      setPathValid(true)
      save(candidate.path)
    },
    [save]
  )

  const updateEnvRow = (index: number, field: 'key' | 'value', value: string): void => {
    setEnvRows((prev) => prev.map((row, i) => (i === index ? { ...row, [field]: value } : row)))
  }
  const removeEnvRow = (index: number): void => {
    setEnvRows((prev) => prev.filter((_, i) => i !== index))
  }
  const addEnvRow = (): void => setEnvRows((prev) => [...prev, { key: '', value: '' }])

  const canSave = !saving && !checking && pathValid !== false && name.trim().length > 0

  return (
    <div className="command-picker-backdrop" onMouseDown={onClose}>
      <div className="edit-project-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <div className="edit-project-header">
          <span>Edit project details</span>
          <button className="hotkey-close" onMouseDown={onClose} title="Close (Esc)">
            ×
          </button>
        </div>

        <div className="edit-project-body">
          <label className="edit-project-field">
            <span>ID</span>
            <input value={project.id} disabled title="The id keys the config file and restore state — not editable" />
          </label>

          <label className="edit-project-field">
            <span>Name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </label>

          <label className="edit-project-field">
            <span>Accent color</span>
            <div className="edit-project-accent-row">
              <div className="edit-project-swatches">
                {ACCENT_SWATCHES.map((c) => (
                  <button
                    key={c}
                    className={`edit-project-swatch${c.toLowerCase() === accentColor.toLowerCase() ? ' selected' : ''}`}
                    style={{ background: c }}
                    onMouseDown={() => setAccentColor(c)}
                    title={c}
                  />
                ))}
              </div>
              <input
                className="edit-project-hex"
                value={accentColor}
                onChange={(e) => setAccentColor(e.target.value)}
                spellCheck={false}
              />
            </div>
          </label>

          <label className="edit-project-field">
            <span>Working directory</span>
            <div className="edit-project-path-row">
              <input
                className={pathValid === false ? 'edit-project-input-invalid' : undefined}
                value={workingDir}
                onChange={(e) => setWorkingDir(e.target.value)}
                spellCheck={false}
              />
              <button onMouseDown={pickFolder}>Browse…</button>
            </div>
            {pathValid === false && !checking && (
              <span className="edit-project-path-error">Folder does not exist</span>
            )}
          </label>

          {suggestions.length > 0 && pathValid === false && (
            <div className="edit-project-suggestions">
              <span className="edit-project-suggestions-label">Did you mean?</span>
              {suggestions.map((s) => (
                <button
                  key={s.path}
                  className="edit-project-suggestion"
                  onMouseDown={() => applySuggestion(s)}
                  title={s.path}
                >
                  {s.path.split(/[\\/]/).pop()}
                  <span className="edit-project-suggestion-reason"> — {REASON_LABEL[s.reason]}</span>
                </button>
              ))}
            </div>
          )}

          <label className="edit-project-field">
            <span>Shell</span>
            <input value={shell} onChange={(e) => setShell(e.target.value)} spellCheck={false} />
          </label>

          <div className="edit-project-field">
            <span>Environment variables</span>
            <div className="edit-project-env-rows">
              {envRows.map((row, i) => (
                <div key={i} className="edit-project-env-row">
                  <input
                    placeholder="NAME"
                    value={row.key}
                    onChange={(e) => updateEnvRow(i, 'key', e.target.value)}
                    spellCheck={false}
                  />
                  <input
                    placeholder="value"
                    value={row.value}
                    onChange={(e) => updateEnvRow(i, 'value', e.target.value)}
                    spellCheck={false}
                  />
                  <button className="edit-project-env-remove" onMouseDown={() => removeEnvRow(i)} aria-label="Remove">
                    &times;
                  </button>
                </div>
              ))}
              <button className="edit-project-env-add" onMouseDown={addEnvRow}>
                + Add variable
              </button>
            </div>
          </div>

          {saveError && <div className="edit-project-save-error">{saveError}</div>}
        </div>

        <div className="edit-project-footer">
          <button onMouseDown={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!canSave} onMouseDown={() => save()}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
