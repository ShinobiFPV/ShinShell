// Dependency-free subsequence fuzzy matcher for the command palette (§6.11).
// Every character of the query must appear in the target, in order;
// contiguous runs score higher so "term" ranks "Terminal" above
// "Tail Q2 logs" even though both technically match.
export function fuzzyScore(query: string, target: string): number | null {
  const q = query.toLowerCase()
  const t = target.toLowerCase()
  if (!q) return 0
  let qi = 0
  let score = 0
  let lastMatchIndex = -1
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += lastMatchIndex === ti - 1 ? 3 : 1
      lastMatchIndex = ti
      qi++
    }
  }
  return qi === q.length ? score : null
}
