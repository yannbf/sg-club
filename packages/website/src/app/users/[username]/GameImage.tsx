'use client'

import Image from 'next/image'

interface GameImageProps {
  appId?: string
  packageId?: string
  name: string
}

export default function GameImage({ appId, packageId, name }: GameImageProps) {
  const src = appId
    ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
    : packageId
      ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${packageId}/header.jpg`
      : 'https://steamplayercount.com/theme/img/placeholder.svg'

  return (
    <div className="w-48 h-24 bg-muted overflow-hidden flex-shrink-0">
      <a href={`https://store.steampowered.com/${appId ? `app/${appId}` : `sub/${packageId}`}`} target="_blank" rel="noopener noreferrer">
        <Image
          src={src}
          alt={name}
          width={192}
          height={96}
          className="w-full h-full object-cover"
          onError={(e) => {
            e.currentTarget.src = 'https://steamplayercount.com/theme/img/placeholder.svg'
          }}
        />
      </a>
    </div>
  )
} 