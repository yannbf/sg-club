'use client'

import { formatDistanceToNow } from 'date-fns'
import Tooltip from './Tooltip'

interface FormattedDateProps {
  timestamp: number // Unix timestamp in seconds
  className?: string
}

export default function FormattedDate({ timestamp, className = '' }: FormattedDateProps) {
  const date = new Date(timestamp * 1000)
  const relativeTime = formatDistanceToNow(date, { addSuffix: true })
  const fullDate = date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  })

  return (
    <Tooltip content={fullDate}>
      <span className={className}>
        {relativeTime}
      </span>
    </Tooltip>
  )
} 