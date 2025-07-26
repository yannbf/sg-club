'use client'

import FormattedDate from './FormattedDate'

export function LastUpdated({ lastUpdatedDate }: { lastUpdatedDate: number | string }) {
  const timestamp = Math.floor(new Date(lastUpdatedDate).getTime() / 1000)

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Last updated: <FormattedDate timestamp={timestamp} />
    </p>
  )
} 