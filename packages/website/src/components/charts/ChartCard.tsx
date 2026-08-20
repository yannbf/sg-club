import * as React from 'react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { cn } from '@/lib/cn'

interface ChartCardProps {
  title: string
  description?: string
  /** At-a-glance headline numbers, rendered under the description. Build with <ChartStat> for emphasis. */
  summary?: React.ReactNode
  icon?: LucideIcon
  className?: string
  children: React.ReactNode
}

/** Card wrapper for a chart: title + optional description/summary, consistent spacing across pages. */
export function ChartCard({
  title,
  description,
  summary,
  icon: Icon,
  className,
  children,
}: ChartCardProps) {
  return (
    <Card className={cn('overflow-hidden', className)}>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          {Icon && <Icon className="h-4 w-4 text-muted-foreground" />}
          {title}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {summary && (
          <p className="text-xs text-muted-foreground">{summary}</p>
        )}
      </CardHeader>
      <CardContent className="pt-2">{children}</CardContent>
    </Card>
  )
}

/** Emphasized number/value within a ChartCard summary line. */
export function ChartStat({ children }: { children: React.ReactNode }) {
  return <span className="font-medium tabular-nums text-foreground">{children}</span>
}
