import { useEffect, useRef, useCallback } from 'react'
import * as monaco from 'monaco-editor'
import './monacoSetup'

interface EditorTabProps {
  filePath: string | null
  active: boolean
  /** § path validation — "opening the editor tree" (the native Open…
   *  dialog) is one of the gated actions; an already-open buffer keeps
   *  working regardless. */
  pathValid: boolean
  guardPathValid: () => boolean
  onFilePathChange: (path: string) => void
  onDirtyChange: (dirty: boolean) => void
}

function languageForPath(path: string | null): string | undefined {
  if (!path) return undefined
  const ext = path.split('.').pop()?.toLowerCase()
  const map: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    html: 'html',
    css: 'css',
    md: 'markdown',
    py: 'python',
    yml: 'yaml',
    yaml: 'yaml',
    ps1: 'powershell',
    sh: 'shell'
  }
  return ext ? map[ext] : undefined
}

export default function EditorTab({
  filePath,
  active,
  pathValid,
  guardPathValid,
  onFilePathChange,
  onDirtyChange
}: EditorTabProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const filePathRef = useRef(filePath)
  filePathRef.current = filePath

  const save = useCallback(async () => {
    const editor = editorRef.current
    if (!editor) return
    let path = filePathRef.current
    if (!path) {
      path = await window.shinshell.files.showSaveDialog()
      if (!path) return
      onFilePathChange(path)
      filePathRef.current = path
    }
    window.shinshell.files.write(path, editor.getValue())
    onDirtyChange(false)
  }, [onFilePathChange, onDirtyChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const editor = monaco.editor.create(container, {
      theme: 'vs-dark',
      automaticLayout: false, // driven manually — see the ResizeObserver below
      fontSize: 13,
      minimap: { enabled: true },
      value: ''
    })
    editorRef.current = editor

    if (filePathRef.current) {
      window.shinshell.files.read(filePathRef.current).then((content) => {
        editor.setValue(content)
      })
    }

    const onChange = editor.onDidChangeModelContent(() => onDirtyChange(true))
    // eslint-disable-next-line no-bitwise
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => save())

    const resizeObserver = new ResizeObserver(() => editor.layout())
    resizeObserver.observe(container)

    return () => {
      onChange.dispose()
      resizeObserver.disconnect()
      editor.getModel()?.dispose()
      editor.dispose()
    }
    // Mount once — filePath changes are handled by the "open" flow below, not
    // by re-running this effect (that would destroy/recreate the editor).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (active) editorRef.current?.layout()
  }, [active])

  const openFile = useCallback(async () => {
    if (!guardPathValid()) return
    const path = await window.shinshell.files.showOpenDialog()
    if (!path) return
    const content = await window.shinshell.files.read(path)
    const language = languageForPath(path)
    const editor = editorRef.current
    if (!editor) return
    const oldModel = editor.getModel()
    const model = monaco.editor.createModel(content, language, monaco.Uri.file(path))
    editor.setModel(model)
    oldModel?.dispose()
    onFilePathChange(path)
    filePathRef.current = path
    onDirtyChange(false)
  }, [onFilePathChange, onDirtyChange, guardPathValid])

  return (
    <div className="editor-tab">
      <div className="editor-toolbar">
        <button onClick={openFile} title={pathValid ? undefined : 'Project folder not found — fix the path first'}>
          Open…
        </button>
        <button onClick={save}>Save</button>
        <span className="editor-path">{filePath || '(unsaved)'}</span>
      </div>
      <div ref={containerRef} className="editor-container" />
    </div>
  )
}
