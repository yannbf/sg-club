'use client'

import * as React from 'react'
import Image from 'next/image'
import { Skeleton } from '@/components/ui/Skeleton'
import { cn } from '@/lib/cn'

interface GameImageProps {
  appId?: string | number | null
  packageId?: string | number | null
  /** Optional pre-known URL to use as a fallback if header.jpg returns 404. */
  fallbackUrl?: string | null
  name: string
  fillWidth?: boolean
  width?: number
  height?: number
  className?: string
  imageClassName?: string
  rounded?: boolean
  link?: boolean
}

const PLACEHOLDER = 'https://steamplayercount.com/theme/img/placeholder.svg'

export function getSteamHeader(
  appId?: string | number | null,
  packageId?: string | number | null,
): string {
  if (appId) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
  }
  if (packageId) {
    return `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${packageId}/header.jpg`
  }
  return PLACEHOLDER
}

export default function GameImage({
  appId,
  packageId,
  fallbackUrl,
  name,
  fillWidth = false,
  width = 460,
  height = 215,
  className,
  imageClassName,
  rounded = false,
  link = true,
}: GameImageProps) {
  const primary = getSteamHeader(appId, packageId)
  const [src, setSrc] = React.useState(primary)
  const [loaded, setLoaded] = React.useState(false)

  React.useEffect(() => {
    setSrc(primary)
    setLoaded(false)
  }, [primary])

  const Inner = (
    <div
      className={cn(
        'relative bg-card-background-hover overflow-hidden',
        rounded ? 'rounded-md' : '',
        fillWidth ? 'w-full' : 'w-48',
        className,
      )}
      style={{ aspectRatio: '460 / 215' }}
    >
      {!loaded && <Skeleton className="absolute inset-0 rounded-none" />}
      <Image
        src={src}
        alt={name}
        width={width}
        height={height}
        className={cn(
          'h-full w-full object-cover transition-opacity duration-300',
          loaded ? 'opacity-100' : 'opacity-0',
          imageClassName,
        )}
        unoptimized
        onLoadingComplete={() => setLoaded(true)}
        onError={() => {
          if (src !== fallbackUrl && fallbackUrl) {
            setSrc(fallbackUrl)
          } else if (src !== PLACEHOLDER) {
            setSrc(PLACEHOLDER)
          }
          setLoaded(true)
        }}
      />
    </div>
  )

  if (!link) return Inner

  const href = appId
    ? `https://store.steampowered.com/app/${appId}`
    : packageId
      ? `https://store.steampowered.com/sub/${packageId}`
      : null

  if (!href) return Inner

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
    >
      {Inner}
    </a>
  )
}
