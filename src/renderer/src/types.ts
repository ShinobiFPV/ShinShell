import type { TabKind } from '../../shared/project'

export type { TabKind }

export interface LeafPane {
  type: 'leaf'
  id: string
  cwd: string
}

export interface SplitPaneNode {
  type: 'split'
  id: string
  direction: 'horizontal' | 'vertical'
  children: [PaneNode, PaneNode]
  sizes: [number, number]
}

export type PaneNode = LeafPane | SplitPaneNode

interface BaseTab {
  id: string
  kind: TabKind
  title: string
}

// terminal + claude-code are both pane-tree tabs (splits, per §6.1) — the
// only difference is claude-code auto-types `claude` on spawn.
export interface TerminalLikeTab extends BaseTab {
  kind: 'terminal' | 'claude-code'
  root: PaneNode
  activePaneId: string
}

export interface ClaudeChatTabData extends BaseTab {
  kind: 'claude-chat'
}

export interface EditorTabData extends BaseTab {
  kind: 'editor'
  filePath: string | null // null = unsaved new file
}

export interface ScratchpadTabData extends BaseTab {
  kind: 'scratchpad'
}

export type Tab = TerminalLikeTab | ClaudeChatTabData | EditorTabData | ScratchpadTabData

export function isTerminalLike(tab: Tab): tab is TerminalLikeTab {
  return tab.kind === 'terminal' || tab.kind === 'claude-code'
}

export function findLeaves(node: PaneNode): LeafPane[] {
  if (node.type === 'leaf') return [node]
  return node.children.flatMap(findLeaves)
}

export function replaceNode(root: PaneNode, targetId: string, replacement: PaneNode): PaneNode {
  if (root.id === targetId) return replacement
  if (root.type === 'leaf') return root
  return {
    ...root,
    children: [
      replaceNode(root.children[0], targetId, replacement),
      replaceNode(root.children[1], targetId, replacement)
    ]
  }
}

export function updateSplitSizes(root: PaneNode, splitId: string, sizes: [number, number]): PaneNode {
  if (root.type === 'leaf') return root
  if (root.id === splitId) return { ...root, sizes }
  return {
    ...root,
    children: [
      updateSplitSizes(root.children[0], splitId, sizes),
      updateSplitSizes(root.children[1], splitId, sizes)
    ]
  }
}

// Removes a leaf pane from the tree. If its parent split is left with one
// child, the parent is collapsed away and replaced by the surviving sibling.
export function removeLeaf(root: PaneNode, leafId: string): PaneNode | null {
  if (root.type === 'leaf') return root.id === leafId ? null : root
  const [a, b] = root.children
  const prunedA = removeLeaf(a, leafId)
  const prunedB = removeLeaf(b, leafId)
  if (prunedA === null) return prunedB
  if (prunedB === null) return prunedA
  if (prunedA === a && prunedB === b) return root
  return { ...root, children: [prunedA, prunedB] }
}
