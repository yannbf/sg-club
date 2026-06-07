import * as React from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/cn'

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition-colors whitespace-nowrap',
  {
    variants: {
      variant: {
        default:
          'border-card-border-strong bg-card-background-hover text-foreground',
        outline: 'border-card-border bg-transparent text-muted-foreground',
        primary:
          'border-transparent bg-[color-mix(in_oklab,var(--primary)_18%,transparent)] text-primary-hi',
        success:
          'border-transparent bg-success-light text-success-foreground',
        warning:
          'border-transparent bg-warning-light text-warning-foreground',
        error: 'border-transparent bg-error-light text-error-foreground',
        info: 'border-transparent bg-info-light text-info-foreground',
        rose: 'border-transparent bg-[color-mix(in_oklab,var(--accent-rose)_18%,transparent)] text-[var(--accent-rose)]',
        purple:
          'border-transparent bg-[color-mix(in_oklab,var(--accent-purple)_18%,transparent)] text-[var(--accent-purple)]',
        amber:
          'border-transparent bg-[color-mix(in_oklab,var(--accent-yellow)_18%,transparent)] text-[var(--accent-yellow)]',
        discord:
          'border-transparent bg-[color-mix(in_oklab,#5865F2_20%,transparent)] text-[#5865F2] dark:text-[#A5AEFF]',
      },
      size: {
        sm: 'px-1.5 py-0 text-[10px]',
        md: 'px-2 py-0.5 text-xs',
        lg: 'px-2.5 py-1 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
)

export type BadgeProps = React.HTMLAttributes<HTMLSpanElement> &
  VariantProps<typeof badgeVariants>

export const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(
  ({ className, variant, size, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  ),
)
Badge.displayName = 'Badge'
