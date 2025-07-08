'use client'

import { useEffect, useState } from 'react'
import { formatLastUpdated } from '@/lib/data'

export function LastUpdated({ lastUpdatedDate }: { lastUpdatedDate: string }) {
  const [formattedDate, setFormattedDate] = useState('')

  useEffect(() => {
    setFormattedDate(formatLastUpdated(lastUpdatedDate))
  }, [lastUpdatedDate])

  if (!formattedDate) {
    return null
  }

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Last updated: {formattedDate}
    </p>
  )
} 