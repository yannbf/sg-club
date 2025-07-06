'use client'

interface UserAvatarProps {
  src: string
  username: string
}

export default function UserAvatar({ src, username }: UserAvatarProps) {
  return (
    <img
      src={src}
      alt={username}
      className="w-6 h-6 rounded-full mr-1"
      onError={(e) => {
        e.currentTarget.src = 'https://cdn-icons-png.flaticon.com/512/9287/9287610.png'
      }}
    />
  )
} 