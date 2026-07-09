import { useEffect, useRef, useState } from 'react'
import type { ClaudeChatNavState } from '../../shared/ipc'

interface ClaudeChatTabProps {
  tabId: string
  active: boolean
}

export default function ClaudeChatTab({ tabId, active }: ClaudeChatTabProps): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const [nav, setNav] = useState<ClaudeChatNavState | null>(null)

  // Create once per tab; the underlying WebContentsView (and its login
  // session — persist:claude-chat, §6.3) outlives tab switches, only
  // destroyed when the tab itself closes.
  useEffect(() => {
    window.shinshell.claudeChat.create(tabId)
    const off = window.shinshell.claudeChat.onNavState((e) => {
      if (e.id === tabId) setNav(e)
    })
    return () => {
      off()
      window.shinshell.claudeChat.destroy(tabId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabId])

  useEffect(() => {
    window.shinshell.claudeChat.setVisible(tabId, active)
  }, [tabId, active])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const report = (): void => {
      const rect = container.getBoundingClientRect()
      window.shinshell.claudeChat.setBounds(tabId, {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      })
    }
    report()
    const resizeObserver = new ResizeObserver(report)
    resizeObserver.observe(container)
    return () => resizeObserver.disconnect()
  }, [tabId])

  return (
    <div className="claude-chat-tab">
      <div className="claude-chat-toolbar">
        <button
          disabled={!nav?.canGoBack}
          onClick={() => window.shinshell.claudeChat.back(tabId)}
          title="Back"
        >
          ←
        </button>
        <button
          disabled={!nav?.canGoForward}
          onClick={() => window.shinshell.claudeChat.forward(tabId)}
          title="Forward"
        >
          →
        </button>
        <button onClick={() => window.shinshell.claudeChat.reload(tabId)} title="Reload">
          ⟳
        </button>
        <span className="claude-chat-title">
          {nav?.loading ? 'Loading…' : nav?.title || 'Claude'}
        </span>
      </div>
      <div ref={containerRef} className="claude-chat-container" />
    </div>
  )
}
