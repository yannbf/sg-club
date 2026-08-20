import type { CSSProperties } from 'react'

/**
 * Shared recharts color/style tokens. Every value here is a CSS variable
 * reference, not a hex literal, so charts stay correct when the theme
 * (next-themes) flips between light and dark — see globals.css for the
 * variable definitions.
 */
export const chartColors = {
  primary: 'var(--primary)',
  primaryHi: 'var(--primary-hi)',
  blue: 'var(--accent-blue)',
  purple: 'var(--accent-purple)',
  green: 'var(--accent-green)',
  yellow: 'var(--accent-yellow)',
  orange: 'var(--accent-orange)',
  red: 'var(--accent-red)',
  rose: 'var(--accent-rose)',
} as const

/** Ordered palette for multi-series/categorical charts (bars, donut slices, ...). */
export const chartPalette = [
  chartColors.blue,
  chartColors.purple,
  chartColors.green,
  chartColors.yellow,
  chartColors.orange,
  chartColors.rose,
  chartColors.primaryHi,
  chartColors.red,
]

/** Shared axis/grid props so every chart shares tick color, font size, and gridline styling. */
export const axisProps = {
  tick: { fill: 'var(--muted-foreground)', fontSize: 12 },
  tickLine: false,
  axisLine: { stroke: 'var(--card-border)' },
} as const

export const gridProps = {
  stroke: 'var(--card-border)',
  strokeDasharray: '3 3',
  vertical: false,
} as const

/** Tooltip container/label/item styling — plain CSS-var values, so it reads correctly in both themes. */
export const tooltipContentStyle: CSSProperties = {
  background: 'var(--card-background)',
  border: '1px solid var(--card-border)',
  borderRadius: '0.5rem',
  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
  fontSize: '0.75rem',
  padding: '0.5rem 0.75rem',
}

export const tooltipLabelStyle: CSSProperties = {
  color: 'var(--foreground)',
  fontWeight: 600,
  marginBottom: '0.25rem',
}

export const tooltipItemStyle: CSSProperties = {
  color: 'var(--muted-foreground)',
}

export function formatUsd(value: number): string {
  return `$${value.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}

export function formatCompact(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

/** Full number with thousands separators, for summary totals (not axis ticks). */
export function formatNumber(value: number): string {
  return value.toLocaleString('en-US', { maximumFractionDigits: 0 })
}

/** Lowercases the compact-notation suffix Intl produces ("16K" -> "16k") to match the site's style. */
function lowercaseCompactSuffix(formatted: string): string {
  return formatted.replace(/([KMBT])$/, (letter) => letter.toLowerCase())
}

/** Compact axis tick for plain numbers: 1200 -> "1.2k". */
export function formatCompactNumber(value: number): string {
  return lowercaseCompactSuffix(
    new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value),
  )
}

/** Compact axis tick for dollar values: 16000 -> "$16k". */
export function formatCompactCurrency(value: number): string {
  return lowercaseCompactSuffix(
    new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value),
  )
}
