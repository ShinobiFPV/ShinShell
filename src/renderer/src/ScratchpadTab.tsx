import { useEffect, useRef } from 'react'
import * as monaco from 'monaco-editor'
import './monacoSetup'

interface ScratchpadTabProps {
  projectId: string
  active: boolean
}

const AUTOSAVE_DEBOUNCE_MS = 1000

export default function ScratchpadTab({ projectId, active }: ScratchpadTabProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const editor = monaco.editor.create(container, {
      theme: 'vs-dark',
      automaticLayout: false,
      fontSize: 13,
      minimap: { enabled: false },
      wordWrap: 'on',
      language: 'markdown',
      value: ''
    })
    editorRef.current = editor

    window.shinshell.scratchpad.load(projectId).then((content) => editor.setValue(content))

    // Auto-saved (§6.4) — no manual save affordance at all.
    let timer: ReturnType<typeof setTimeout> | null = null
    const onChange = editor.onDidChangeModelContent(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        window.shinshell.scratchpad.save(projectId, editor.getValue())
      }, AUTOSAVE_DEBOUNCE_MS)
    })

    const resizeObserver = new ResizeObserver(() => editor.layout())
    resizeObserver.observe(container)

    return () => {
      if (timer) {
        clearTimeout(timer)
        window.shinshell.scratchpad.save(projectId, editor.getValue())
      }
      onChange.dispose()
      resizeObserver.disconnect()
      editor.getModel()?.dispose()
      editor.dispose()
    }
  }, [projectId])

  useEffect(() => {
    if (active) editorRef.current?.layout()
  }, [active])

  return (
    <div className="editor-tab">
      <div className="editor-toolbar">
        <span className="editor-path">Scratchpad (auto-saved)</span>
      </div>
      <div ref={containerRef} className="editor-container" />
    </div>
  )
}
