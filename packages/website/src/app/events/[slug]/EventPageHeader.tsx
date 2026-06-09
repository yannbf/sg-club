'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft,
  CalendarDays,
  ExternalLink,
  Gift,
  Globe,
  Maximize2,
  PartyPopper,
  Trophy,
  X,
} from 'lucide-react'
import type { EventMeta } from '@/lib/events'
import { Badge } from '@/components/ui/Badge'

/**
 * Full-screen poster viewer. Closes on Escape, on the close (✕) button, and on
 * a click outside the image. Rendered via a portal so the header's
 * `overflow-hidden` can't clip it, and it locks body scroll while open.
 */
function PosterLightbox({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [onClose])

  if (!mounted) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt}
      onClick={onClose}
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/85 p-4 backdrop-blur-sm sm:p-8"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
      >
        <X className="h-5 w-5" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
      />
    </div>,
    document.body,
  )
}

/**
 * Turns bare http(s) URLs in free text into clickable links, leaving the rest
 * as plain text (so `whitespace-pre-line` still preserves paragraph breaks).
 * Trailing sentence punctuation is kept out of the link target.
 */
function linkify(text: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = []
  const re = /(https?:\/\/[^\s]+)/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    let url = m[0]
    let trail = ''
    const tm = url.match(/[.,;:!?)\]]+$/)
    if (tm) {
      trail = tm[0]
      url = url.slice(0, -trail.length)
    }
    nodes.push(
      <a
        key={m.index}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="font-medium text-accent underline underline-offset-2 transition-colors hover:no-underline"
      >
        {url}
      </a>,
    )
    if (trail) nodes.push(trail)
    last = m.index + m[0].length
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

/**
 * Event description with a "Read more" toggle. Longer announcements are clamped
 * to three lines so they don't dominate the header; short ones render in full
 * with no toggle. Preserves the paragraph breaks stored as `\n\n`.
 */
function EventDescription({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false)
  const isLong = text.length > 280

  return (
    <div className="max-w-3xl space-y-1">
      <p
        className={`whitespace-pre-line break-words text-sm leading-relaxed text-muted-foreground sm:text-base ${
          isLong && !expanded ? 'line-clamp-3' : ''
        }`}
      >
        {linkify(text)}
      </p>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="text-sm font-medium text-accent transition-colors hover:underline"
        >
          {expanded ? 'Read less' : 'Read more'}
        </button>
      )}
    </div>
  )
}

function formatRange(start: number | null, end: number | null): string {
  if (!start) return 'Dates TBD'
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }
  const startStr = new Date(start * 1000).toLocaleDateString('en-GB', opts)
  if (!end) return `Started ${startStr}`
  return `${startStr} – ${new Date(end * 1000).toLocaleDateString('en-GB', opts)}`
}

export function EventPageHeader({
  meta,
  startTimestamp,
  endTimestamp,
  isOngoing,
  children,
}: {
  meta: EventMeta
  startTimestamp: number | null
  endTimestamp: number | null
  isOngoing?: boolean
  /** Optional extra content rendered under the description (e.g. winner banner). */
  children?: React.ReactNode
}) {
  const isChallenge = meta.kind === 'challenge'
  const isSpecial = meta.kind === 'special'
  const [posterOpen, setPosterOpen] = useState(false)

  return (
    <header className="relative overflow-hidden rounded-2xl border border-card-border bg-card-background">
      {/* Accent glow */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background: `radial-gradient(120% 80% at 0% 0%, color-mix(in oklab, ${meta.accent} 18%, transparent) 0%, transparent 55%)`,
        }}
        aria-hidden
      />
      <div className="relative space-y-5 p-6 sm:p-8">
        <Link
          href="/events"
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          All events
        </Link>

        <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
          {meta.bannerUrl ? (
            <button
              type="button"
              onClick={() => setPosterOpen(true)}
              title="View full poster"
              aria-label={`View ${meta.name} poster full screen`}
              className="group/poster relative block h-auto w-28 flex-shrink-0 cursor-zoom-in overflow-hidden rounded-xl shadow-sm ring-1 ring-card-border transition-shadow hover:ring-card-border-strong sm:w-40"
            >
              <Image
                src={meta.bannerUrl}
                alt={`${meta.name} poster`}
                width={1024}
                height={1536}
                unoptimized
                className="h-auto w-full transition-transform duration-300 group-hover/poster:scale-105"
              />
              <span className="pointer-events-none absolute bottom-1.5 right-1.5 flex h-7 w-7 items-center justify-center rounded-full bg-black/55 text-white opacity-0 backdrop-blur-sm transition-opacity group-hover/poster:opacity-100">
                <Maximize2 className="h-3.5 w-3.5" />
              </span>
            </button>
          ) : meta.imageUrl ? (
            <Image
              src={meta.imageUrl}
              alt={meta.name}
              width={64}
              height={64}
              unoptimized
              className="h-16 w-16 flex-shrink-0 rounded-2xl object-cover shadow-sm ring-1 ring-card-border"
            />
          ) : (
            <span
              className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-2xl text-4xl shadow-sm ring-1 ring-card-border"
              style={{
                background: `color-mix(in oklab, ${meta.accent} 22%, var(--card-background))`,
              }}
              aria-hidden
            >
              {meta.emoji}
            </span>
          )}

          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              {isOngoing && (
                <span className="inline-flex items-center gap-1.5 rounded-full bg-[var(--success)]/15 px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide text-success-foreground">
                  <span className="relative flex h-2 w-2">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--success)] opacity-75" />
                    <span className="relative inline-flex h-2 w-2 rounded-full bg-[var(--success)]" />
                  </span>
                  Live now
                </span>
              )}
              <Badge
                variant={isChallenge ? 'primary' : isSpecial ? 'amber' : 'purple'}
                size="md"
              >
                {isChallenge ? (
                  <>
                    <Trophy className="h-3.5 w-3.5" /> Gaming Challenge
                  </>
                ) : isSpecial ? (
                  <>
                    <PartyPopper className="h-3.5 w-3.5" /> Special Event
                  </>
                ) : (
                  <>
                    <Gift className="h-3.5 w-3.5" /> Monthly Event
                  </>
                )}
              </Badge>
            </div>

            <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
              {meta.name}
            </h1>

            {meta.tagline && (
              <p
                className="text-sm font-medium"
                style={{ color: meta.accent }}
              >
                {meta.tagline}
              </p>
            )}

            <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <CalendarDays className="h-4 w-4" />
              {formatRange(startTimestamp, endTimestamp)}
            </p>

            <EventDescription text={meta.description} />

            {/* Only monthly giveaway events show the inline website link;
                challenges have none and special events render their own CTA.
                When there's no link yet, we simply show nothing. */}
            {meta.kind === 'giveaway' && meta.websiteUrl && (
              <div className="pt-1">
                <a
                  href={meta.websiteUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-md border border-card-border bg-card-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-card-background-hover"
                >
                  <Globe className="h-4 w-4" />
                  Event website
                  <ExternalLink className="h-3.5 w-3.5 text-muted-foreground" />
                </a>
              </div>
            )}

            {children}
          </div>
        </div>
      </div>

      {meta.bannerUrl && posterOpen && (
        <PosterLightbox
          src={meta.bannerUrl}
          alt={`${meta.name} poster`}
          onClose={() => setPosterOpen(false)}
        />
      )}
    </header>
  )
}
