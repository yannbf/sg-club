'use client'

import { useEffect, useRef, useState } from 'react'
import Tooltip from './Tooltip'
import { Badge } from './ui/Badge'
import { DiscordIcon } from './icons/DiscordIcon'

interface DiscordBadgeProps {
  /** Undefined when the member isn't tracked in discord_members.json at all. */
  member?: boolean
  /** Discord account handle, present for members we've matched to an account. */
  handle?: string
  size?: 'sm' | 'md'
  /** Label shown when the member is not on Discord. */
  absentLabel?: string
}

const COPIED_RESET_MS = 1500

/**
 * Discord membership badge. When we know the member's handle the badge becomes
 * a button: hovering reveals the handle, clicking copies it — the handle is
 * what an admin needs to actually reach someone, and retyping it from a
 * tooltip is exactly the kind of transcription that goes wrong.
 */
export function DiscordBadge({
  member,
  handle,
  size = 'sm',
  absentLabel = 'Not on Discord',
}: DiscordBadgeProps) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  if (member === undefined) return null

  if (!member) {
    return (
      <Badge
        variant="outline"
        size={size}
        title="Not in the community Discord server"
      >
        <DiscordIcon className="h-3 w-3" />
        {absentLabel}
      </Badge>
    )
  }

  // On Discord but unmatched to an account — nothing to reveal or copy.
  if (!handle) {
    return (
      <Badge variant="discord" size={size} title="In the community Discord server">
        <DiscordIcon className="h-3 w-3" />
        Discord
      </Badge>
    )
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(handle)
    } catch {
      // Clipboard is unavailable outside a secure context; leave the badge
      // unchanged rather than claiming a copy that didn't happen.
      return
    }
    setCopied(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), COPIED_RESET_MS)
  }

  return (
    <Tooltip content={copied ? 'Copied!' : `${handle} — click to copy`}>
      <button
        type="button"
        onClick={(event) => {
          // These badges sit inside linked user rows; copying shouldn't navigate.
          event.preventDefault()
          event.stopPropagation()
          void copy()
        }}
        className="inline-flex cursor-pointer rounded-full align-middle hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#5865F2]"
        aria-label={`Discord handle ${handle}, click to copy`}
      >
        <Badge variant="discord" size={size}>
          <DiscordIcon className="h-3 w-3" />
          {copied ? 'Copied!' : 'Discord'}
        </Badge>
      </button>
    </Tooltip>
  )
}
