export interface TagCount {
  tag: string
  count: number
}

/** Every tag across `tagLists` with the number of games carrying it, most
 *  common first (ties alphabetical). */
export function countTags(tagLists: Iterable<readonly string[] | undefined>): TagCount[] {
  const counts = new Map<string, number>()
  for (const tags of tagLists) {
    if (!tags) continue
    for (const tag of new Set(tags)) counts.set(tag, (counts.get(tag) ?? 0) + 1)
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
}

/** True when the game carries at least one selected tag. An empty selection
 *  matches everything; a game without tags matches nothing else. */
export function matchesAnyTag(
  tags: readonly string[] | undefined,
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true
  if (!tags) return false
  return selected.some((tag) => tags.includes(tag))
}

/** True when any tag name contains the lower-cased search `term`. */
export function tagsMatchSearch(
  tags: readonly string[] | undefined,
  term: string,
): boolean {
  return !!tags && tags.some((tag) => tag.toLowerCase().includes(term))
}

/** Adds `tag` to the selection, or removes it when already selected. */
export function toggleTag(selected: readonly string[], tag: string): string[] {
  return selected.includes(tag)
    ? selected.filter((t) => t !== tag)
    : [...selected, tag]
}
