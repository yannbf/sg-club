import { ImageResponse } from 'next/og'
import { allEventSlugs, getEventBySlug } from '@/lib/events'
import { getChallengeData } from '@/lib/data'
import type { EventMeta } from '@/lib/events'

/**
 * Build-time Open Graph image for each /events/[slug] page — the card people
 * see when a challenge or event link is shared to Discord, Twitter, Slack, etc.
 * Rendered at build (static export) into a PNG per event via generateStaticParams.
 *
 * The card blends the game's Steam cover art (challenges) or the event's poster
 * (monthly/special events): a cinematic full-bleed wash fading into the site's
 * dark theme, with the title, kicker, tagline and live status on the left and a
 * crisp portrait capsule on the right. Falls back to a clean branded card when
 * an event has no art. Uses next/og's default font (no external font fetch), so
 * the build can't break on a font CDN hiccup.
 */

export const alt = 'The Giveaways Club'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

export function generateStaticParams() {
  return allEventSlugs().map((slug) => ({ slug }))
}

const BG = '#07070d'
const FG = '#f1f3f8'
const MUTED = '#9ca3b8'

/** Map an event's `var(--token)` accent to a concrete dark-theme hex. */
function accentHex(accent: string | undefined): string {
  const token = accent?.match(/--([a-z-]+)/)?.[1] ?? ''
  const map: Record<string, string> = {
    primary: '#8b5cf6',
    'accent-yellow': '#facc15',
    'accent-rose': '#f43f5e',
    'accent-green': '#22c55e',
    'accent-purple': '#a78bfa',
    'accent-blue': '#38bdf8',
    'accent-orange': '#fb923c',
    info: '#38bdf8',
    warning: '#f59e0b',
  }
  return map[token] ?? '#8b5cf6'
}

/** Fetch a remote/local image and inline it as a data URL (guarded + timed out). */
async function loadImage(src: string | undefined | null): Promise<string | null> {
  if (!src) return null
  try {
    if (src.startsWith('/')) {
      const { readFileSync } = await import('node:fs')
      const { join } = await import('node:path')
      const buf = readFileSync(join(process.cwd(), 'public', src))
      const ext = src.split('.').pop()?.toLowerCase()
      const type = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/png'
      return `data:${type};base64,${Buffer.from(buf).toString('base64')}`
    }
    const res = await fetch(src, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) return null
    const type = res.headers.get('content-type') ?? 'image/jpeg'
    return `data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`
  } catch {
    return null
  }
}

/** First image in the candidate list that loads successfully. */
async function firstImage(urls: (string | undefined | null)[]): Promise<string | null> {
  for (const u of urls) {
    const d = await loadImage(u)
    if (d) return d
  }
  return null
}

const steamAsset = (appId: number, name: string) =>
  `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/${name}`
const steamCdn = (appId: number, name: string) =>
  `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/${name}`

function kindLabel(event: EventMeta): string {
  if (event.kind === 'challenge') return 'GAMING CHALLENGE'
  if (event.kind === 'giveaway') return 'GIVEAWAY EVENT'
  return event.monthly ? 'MONTHLY EVENT' : 'COMMUNITY EVENT'
}

export default async function Image(props: {
  params: Promise<{ slug: string }> | { slug: string }
}) {
  const { slug } = await props.params
  const event = getEventBySlug(slug)

  // Unknown slug: a minimal branded fallback so shares still render an image.
  if (!event) {
    return new ImageResponse(
      (
        <div
          style={{
            display: 'flex',
            width: '100%',
            height: '100%',
            background: BG,
            color: FG,
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 56,
            fontWeight: 700,
          }}
        >
          The Giveaways Club
        </div>
      ),
      { ...size },
    )
  }

  const accent = accentHex(event.accent)
  // The club's mascot logo, cropped to a circle in the brand row (mirrors the
  // site header). Falls back to an accent dot if it can't be read.
  const logo = await loadImage('/tgc-logo.jpg')

  // Resolve the game's app id (challenges) for Steam cover art.
  const appIdMatch = event.imageUrl?.match(/\/apps\/(\d+)\//)
  let appId: number | null = appIdMatch ? Number(appIdMatch[1]) : null

  // Status line (challenges get a live/qualified readout from the leaderboard).
  let status: string | null = null
  if (event.kind === 'challenge' && event.challengeSlug) {
    const data = await getChallengeData(event.challengeSlug)
    if (data) {
      if (data.appId) appId = data.appId
      if (data.winType === 'completion' || data.winType == null) {
        const n =
          data.winnerUsernames?.length ?? (data.winnerUsername ? 1 : 0)
        const qualified = `${n} qualified`
        status = data.challengeOver ? qualified : n > 0 ? `Live · ${qualified}` : 'Live'
      } else {
        status = data.winnerUsername ? `Winner: ${data.winnerUsername}` : 'Live'
      }
    }
  } else if (event.startTimestamp || event.endTimestamp) {
    const now = Date.now() / 1000
    if (event.headlineStat) {
      status = `${event.headlineStat.value} ${event.headlineStat.label}`
    } else if (event.endTimestamp && now > event.endTimestamp) {
      status = 'Ended'
    } else if (event.startTimestamp && now < event.startTimestamp) {
      status = 'Upcoming'
    } else {
      status = 'Live'
    }
  }

  // Cover art: Steam hero + portrait capsule for challenges, else the event's
  // own poster art on both layers.
  const bg = appId
    ? await firstImage([
        steamAsset(appId, 'library_hero.jpg'),
        steamCdn(appId, 'library_hero.jpg'),
        steamAsset(appId, 'header.jpg'),
        event.bannerUrl,
      ])
    : await loadImage(event.bannerUrl ?? event.imageUrl)
  const poster = appId
    ? await firstImage([
        steamCdn(appId, 'library_600x900.jpg'),
        steamAsset(appId, 'library_600x900.jpg'),
        event.bannerUrl,
        event.imageUrl,
      ])
    : await loadImage(event.bannerUrl ?? event.imageUrl)

  // Split "Gaming Challenge #3 — Neo Cab" into a kicker + a big title.
  const dash = event.name.match(/\s[—–-]\s/)
  const kicker = dash
    ? event.name.slice(0, dash.index).trim().toUpperCase()
    : kindLabel(event)
  const title = dash
    ? event.name.slice((dash.index ?? 0) + dash[0].length).trim()
    : event.name

  return new ImageResponse(
    (
      <div
        style={{
          position: 'relative',
          display: 'flex',
          width: '100%',
          height: '100%',
          background: BG,
          color: FG,
          overflow: 'hidden',
        }}
      >
        {bg && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={bg}
            width={1200}
            height={630}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              opacity: 0.5,
            }}
          />
        )}
        {/* Blend the art into the site's dark theme, keeping the left readable. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            background:
              'linear-gradient(90deg, #07070d 33%, rgba(7,7,13,0.82) 58%, rgba(7,7,13,0.30) 100%)',
          }}
        />
        {/* Accent hairline along the top. */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            height: 6,
            display: 'flex',
            background: accent,
          }}
        />

        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'row',
            width: '100%',
            height: '100%',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              flex: 1,
              padding: '58px 64px',
            }}
          >
            {/* Brand */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  width={46}
                  height={46}
                  style={{
                    borderRadius: 999,
                    border: '1px solid rgba(255,255,255,0.18)',
                    objectFit: 'cover',
                  }}
                />
              ) : (
                <div
                  style={{
                    display: 'flex',
                    width: 34,
                    height: 34,
                    borderRadius: 9,
                    background: accent,
                  }}
                />
              )}
              <div
                style={{
                  fontSize: 22,
                  fontWeight: 600,
                  letterSpacing: 3,
                  color: '#c0c5d4',
                }}
              >
                THE GIVEAWAYS CLUB
              </div>
            </div>

            {/* Headline */}
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div
                style={{
                  fontSize: 29,
                  fontWeight: 700,
                  letterSpacing: 1,
                  color: accent,
                }}
              >
                {kicker}
              </div>
              <div
                style={{
                  fontSize: title.length > 22 ? 62 : 80,
                  fontWeight: 800,
                  lineHeight: 1.03,
                  marginTop: 10,
                  maxWidth: 660,
                }}
              >
                {title}
              </div>
              {event.tagline && (
                <div style={{ fontSize: 31, color: MUTED, marginTop: 16, maxWidth: 640 }}>
                  {event.tagline}
                </div>
              )}
            </div>

            {/* Status */}
            {status ? (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 22px',
                    borderRadius: 999,
                    background: 'rgba(255,255,255,0.06)',
                    border: `1px solid ${accent}88`,
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      width: 12,
                      height: 12,
                      borderRadius: 999,
                      background: accent,
                    }}
                  />
                  <div style={{ fontSize: 26, fontWeight: 600, color: accent }}>
                    {status}
                  </div>
                </div>
              </div>
            ) : (
              <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>
                sg-club.vercel.app
              </div>
            )}
          </div>

          {poster && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                paddingRight: 60,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={poster}
                width={300}
                height={450}
                style={{
                  borderRadius: 18,
                  border: '1px solid rgba(255,255,255,0.14)',
                  objectFit: 'cover',
                }}
              />
            </div>
          )}
        </div>
      </div>
    ),
    { ...size },
  )
}
