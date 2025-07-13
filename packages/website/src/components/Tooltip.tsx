'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { ReactNode } from 'react'

interface TooltipProps {
  children: ReactNode
  content: ReactNode
  delayDuration?: number
}

export default function Tooltip({ children, content, delayDuration = 200 }: TooltipProps) {
  return (
    <TooltipPrimitive.Provider>
      <TooltipPrimitive.Root delayDuration={delayDuration}>
        <TooltipPrimitive.Trigger asChild>
          {children}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="z-50 overflow-hidden rounded-md border border-card-border bg-card-background px-3 py-1.5 text-sm text-foreground shadow-md animate-in fade-in-0 zoom-in-95"
            sideOffset={5}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-card-border" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
} 