'use client'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/Select'
import { cn } from '@/lib/cn'

export interface FilterSelectOption<T extends string> {
  value: T
  label: string
}

/**
 * Themed dropdown for filter/sort controls. Native `<select>` popups take the
 * OS colour scheme rather than the page theme, so on some systems the open
 * menu is unreadable; the Radix menu renders inside the page and follows it.
 */
export function FilterSelect<T extends string>({
  id,
  value,
  onValueChange,
  options,
  className,
  'aria-label': ariaLabel,
}: {
  id?: string
  value: T
  onValueChange: (value: T) => void
  options: FilterSelectOption<T>[]
  className?: string
  'aria-label'?: string
}) {
  return (
    <Select value={value} onValueChange={(v) => onValueChange(v as T)}>
      <SelectTrigger id={id} aria-label={ariaLabel} className={cn('h-9 w-auto min-w-[8rem]', className)}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
