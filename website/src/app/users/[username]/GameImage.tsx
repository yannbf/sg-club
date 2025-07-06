'use client'

interface GameImageProps {
  appId?: string | null
  packageId?: string | null
  name: string
}

export default function GameImage({ appId, packageId, name }: GameImageProps) {
  return (
    <div className="w-32 h-24 bg-gray-200 flex-shrink-0 overflow-hidden">
      <img
        src={
          appId
            ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${appId}/header.jpg`
            : packageId
            ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/subs/${packageId}/header.jpg`
            : 'https://steamplayercount.com/theme/img/placeholder.svg'
        }
        alt={name}
        className="w-full h-full object-cover"
        onError={(e) => {
          e.currentTarget.src = 'https://steamplayercount.com/theme/img/placeholder.svg'
        }}
      />
    </div>
  )
} 