import type { JSX } from 'preact'
import type { ParsedPrompt } from '../permissionPrompt'

interface PermissionPromptCardProps {
  prompt: ParsedPrompt
  onSelect: (index: number) => void
}

// § Session view polish — the clean stand-in for Claude Code's ink-drawn
// permission/confirmation box (see permissionPrompt.ts for why raw
// rendering of that box reads as garbled on a narrow phone screen). Covers
// the terminal canvas entirely while showing; tapping an option sends the
// arrow+Enter sequence needed to actually select it in the real dialog.
export default function PermissionPromptCard({ prompt, onSelect }: PermissionPromptCardProps): JSX.Element {
  return (
    <div class="permission-prompt-card">
      <div class="permission-prompt-header">{prompt.header}</div>
      <div class="permission-prompt-options">
        {prompt.options.map((option, i) => (
          <button
            key={i}
            type="button"
            class={
              i === prompt.selectedIndex
                ? 'permission-prompt-option permission-prompt-option-selected'
                : 'permission-prompt-option'
            }
            onClick={() => onSelect(i)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}
