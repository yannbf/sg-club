'use client'

import FormattedDate from './FormattedDate'

export function LastUpdated({
  lastUpdatedDate,
  updateIntervalDays,
}: {
  lastUpdatedDate: number | string
  /**
   * For pages that are intentionally not refreshed daily (e.g. wishlist,
   * ended game challenges). When set, we skip the "deployment broken" warning
   * and instead show the expected cadence.
   */
  updateIntervalDays?: number
}) {
  const timestamp = Math.floor(new Date(lastUpdatedDate).getTime() / 1000)

  if (updateIntervalDays) {
    return (
      <p className="mt-2 text-sm text-muted-foreground">
        Last updated: <FormattedDate timestamp={timestamp} />
        <span className="ml-2">(updated every {updateIntervalDays} days)</span>
      </p>
    )
  }

  const now = Math.floor(Date.now() / 1000)
  const diffInSeconds = now - timestamp
  const twoDaysInSeconds = 2 * 24 * 60 * 60
  const isOutdated = diffInSeconds > twoDaysInSeconds

  return (
    <p className="mt-2 text-sm text-muted-foreground">
      Last updated: <FormattedDate timestamp={timestamp} />
      {isOutdated && (
        <span className="ml-2 text-red-500">
          (Something going wrong in the deployment, please report)
        </span>
      )}
    </p>
  )
} 