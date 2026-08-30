'use client'

import { formatDistanceToNow } from 'date-fns'
import Tooltip from './Tooltip'

interface FormattedDateProps {
  timestamp: number // Unix timestamp in seconds
  className?: string
}

interface TimeDifferenceProps {
  startTimestamp: number
  endTimestamp: number
  className?: string
}

export function TimeDifference({ startTimestamp, endTimestamp, className = '' }: TimeDifferenceProps) {
  const startDate = new Date(startTimestamp * 1000)
  const endDate = new Date(endTimestamp * 1000)
  const diffInSeconds = Math.abs(endTimestamp - startTimestamp)
  
  const days = Math.floor(diffInSeconds / 86400)
  const hours = Math.floor((diffInSeconds % 86400) / 3600)
  const minutes = Math.floor((diffInSeconds % 3600) / 60)

  const formattedDiff = [
    days > 0 ? `${days}d` : null,
    hours > 0 ? `${hours}h` : null, 
    minutes > 0 ? `${minutes}m` : null
  ].filter(Boolean).join(' ')

  const fullDiff = `From ${startDate.toLocaleString()} to ${endDate.toLocaleString()}`

  return (
    <Tooltip content={fullDiff}>
      <span className={className}>
        {formattedDiff || 'Less than 1 minute'}
      </span>
    </Tooltip>
  )
}

export function getFullDate(timestamp: number) {
  const date = new Date(timestamp * 1000)
  const fullDate = date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long', 
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  })

  return fullDate
}

// Day-granularity relative phrase ("today", "yesterday", "N days ago"),
// falling back to date-fns' relative phrasing past ~30 days. The day
// difference is computed by calendar day (not 24h buckets), so someone
// online at 23:50 yesterday still reads as "yesterday" 20 minutes later.
// The tooltip shows only the date, never the time, even though the
// underlying timestamp is precise.
export function FormattedDay({ timestamp, className = '' }: FormattedDateProps) {
  const date = new Date(timestamp * 1000)
  const now = new Date()

  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())
  const diffDays = Math.round(
    (startOfDay(now).getTime() - startOfDay(date).getTime()) / 86400000,
  )

  let relativeTime: string
  if (diffDays <= 0) {
    relativeTime = 'today'
  } else if (diffDays === 1) {
    relativeTime = 'yesterday'
  } else if (diffDays < 30) {
    relativeTime = `${diffDays} days ago`
  } else {
    relativeTime = formatDistanceToNow(date, { addSuffix: true })
  }

  const fullDate = date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Tooltip content={fullDate}>
      <span className={className}>{relativeTime}</span>
    </Tooltip>
  )
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