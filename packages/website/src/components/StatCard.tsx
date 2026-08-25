import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { cn } from '@/lib/cn'

interface StatCardProps {
  label: string
  value: React.ReactNode
  icon?: LucideIcon
  hint?: React.ReactNode
  trend?: {
    value: string
    direction: 'up' | 'down' | 'flat'
  }
  accent?: 'primary' | 'green' | 'blue' | 'rose' | 'amber' | 'purple'
  className?: string
  /** Renders the card as a toggleable filter button instead of a static tile. */
  onClick?: () => void
  /** Only meaningful alongside `onClick` — highlights this card as the active filter. */
  selected?: boolean
}

const accentMap: Record<NonNullable<StatCardProps['accent']>, string> = {
  primary: 'text-primary-hi',
  green: 'text-accent-green',
  blue: 'text-accent-blue',
  rose: 'text-accent-rose',
  amber: 'text-accent-yellow',
  purple: 'text-accent-purple',
}

const iconBgMap: Record<NonNullable<StatCardProps['accent']>, string> = {
  primary: 'bg-[color-mix(in_oklab,var(--primary)_18%,transparent)]',
  green: 'bg-[color-mix(in_oklab,var(--accent-green)_18%,transparent)]',
  blue: 'bg-[color-mix(in_oklab,var(--accent-blue)_18%,transparent)]',
  rose: 'bg-[color-mix(in_oklab,var(--accent-rose)_18%,transparent)]',
  amber: 'bg-[color-mix(in_oklab,var(--accent-yellow)_18%,transparent)]',
  purple: 'bg-[color-mix(in_oklab,var(--accent-purple)_18%,transparent)]',
}

const glowMap: Record<NonNullable<StatCardProps['accent']>, string> = {
  primary:
    "before:bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--primary)_14%,transparent)_0%,transparent_60%)]",
  green:
    "before:bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--accent-green)_14%,transparent)_0%,transparent_60%)]",
  blue: "before:bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--accent-blue)_14%,transparent)_0%,transparent_60%)]",
  rose: "before:bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--accent-rose)_14%,transparent)_0%,transparent_60%)]",
  amber:
    "before:bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--accent-yellow)_14%,transparent)_0%,transparent_60%)]",
  purple:
    "before:bg-[radial-gradient(120%_70%_at_0%_0%,color-mix(in_oklab,var(--accent-purple)_14%,transparent)_0%,transparent_60%)]",
}

export function StatCard({
  label,
  value,
  icon: Icon,
  hint,
  trend,
  accent = 'primary',
  className,
  onClick,
  selected = false,
}: StatCardProps) {
  const cardClassName = cn(
    'relative overflow-hidden rounded-xl border border-card-border bg-card-background p-5 text-left shadow-sm transition-all',
    'before:absolute before:inset-0 before:pointer-events-none before:opacity-90',
    glowMap[accent],
    onClick && 'cursor-pointer hover:border-card-border-strong hover:bg-card-background-hover',
    onClick &&
      selected &&
      '-translate-y-0.5 border-transparent ring-2 ring-primary ring-offset-2 ring-offset-background shadow-md',
    className,
  )

  const content = (
    <div className="relative flex items-start justify-between gap-4">
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </p>
        <p
          className={cn(
            'mt-2 text-3xl font-semibold leading-none tabular-nums-strict tracking-tight',
            accentMap[accent],
          )}
        >
          {value}
        </p>
        {hint && <p className="mt-2 text-xs text-muted-foreground">{hint}</p>}
        {trend && (
          <p
            className={cn(
              'mt-2 inline-flex items-center gap-1 text-xs font-medium',
              trend.direction === 'up' && 'text-success-foreground',
              trend.direction === 'down' && 'text-error-foreground',
              trend.direction === 'flat' && 'text-muted-foreground',
            )}
          >
            <span aria-hidden>
              {trend.direction === 'up' ? '↑' : trend.direction === 'down' ? '↓' : '→'}
            </span>
            {trend.value}
          </p>
        )}
      </div>
      {Icon && (
        <div
          className={cn(
            'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg',
            iconBgMap[accent],
            accentMap[accent],
          )}
        >
          <Icon className="h-5 w-5" />
        </div>
      )}
    </div>
  )

  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-pressed={selected} className={cardClassName}>
        {content}
      </button>
    )
  }

  return <Card className={cardClassName}>{content}</Card>
}
