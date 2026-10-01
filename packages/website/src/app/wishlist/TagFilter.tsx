'use client'

import { useMemo, useState } from 'react'
import { Check, Search, Tags } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/Popover'
import { cn } from '@/lib/cn'
import type { TagCount } from '@/lib/wishlist-tags'

interface TagFilterProps {
  /** Every tag in the data with its game count, most common first. */
  tagCounts: TagCount[]
  selected: string[]
  onToggle: (tag: string) => void
}

/** Searchable multi-select of tags; the list is capped so the popover stays
 *  light while still searchable down to the rarest tag. */
const MAX_LISTED = 100

export function TagFilter({ tagCounts, selected, onToggle }: TagFilterProps) {
  const [query, setQuery] = useState('')

  const { listed, matchCount } = useMemo(() => {
    const term = query.toLowerCase().trim()
    const matches = term
      ? tagCounts.filter((t) => t.tag.toLowerCase().includes(term))
      : tagCounts
    return { listed: matches.slice(0, MAX_LISTED), matchCount: matches.length }
  }, [tagCounts, query])

  return (
    <Popover onOpenChange={(open) => !open && setQuery('')}>
      <PopoverTrigger asChild>
        <Button variant="outline" aria-label="Filter by tag">
          <Tags className="h-4 w-4" />
          Tags
          {selected.length > 0 && (
            <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold tabular-nums-strict text-primary-foreground">
              {selected.length}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="bottom"
        className="w-[min(22rem,calc(100vw-1.5rem))] max-w-none p-3"
      >
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tags..."
            aria-label="Search tags"
            className="pl-9"
          />
        </div>
        <ul className="mt-2 max-h-72 space-y-0.5 overflow-y-auto">
          {listed.map(({ tag, count }) => {
            const isSelected = selected.includes(tag)
            return (
              <li key={tag}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={isSelected}
                  onClick={() => onToggle(tag)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-background-elevated',
                    isSelected && 'text-foreground',
                  )}
                >
                  <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
                    {isSelected && <Check className="h-4 w-4 text-accent" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{tag}</span>
                  <span className="font-mono text-xs text-muted-foreground tabular-nums-strict">
                    {count}
                  </span>
                </button>
              </li>
            )
          })}
          {listed.length === 0 && (
            <li className="px-2 py-3 text-center text-xs text-muted-foreground">
              No tag matches
            </li>
          )}
        </ul>
        {matchCount > listed.length && (
          <p className="mt-2 text-center text-xs text-muted-foreground">
            Showing the {listed.length} most common of {matchCount} — search to
            narrow
          </p>
        )}
      </PopoverContent>
    </Popover>
  )
}
