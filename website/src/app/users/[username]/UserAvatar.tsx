'use client'

import Image from 'next/image'

interface UserAvatarProps {
  src: string
  username: string
}

export default function UserAvatar({ src, username }: UserAvatarProps) {
  return (
    <Image
      src={src}
      alt={username}
      width={24}
      height={24}
      className="rounded-full mr-1"
      onError={(e) => {
        e.currentTarget.src = 'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'
      }}
    />
  )
} 