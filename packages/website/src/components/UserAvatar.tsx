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
      alt={`${username}'s avatar`}
      width={24}
      height={24}
      className="rounded-full mr-1"
      onError={(e) => {
        e.currentTarget.src = 'https://images.icon-icons.com/2550/PNG/512/question_mark_circle_icon_152550.png'
      }}
    />
  )
} 