'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { ReactNode, useState } from 'react'

interface TooltipProps {
  children: ReactNode
  content: ReactNode
  delayDuration?: number
}

// Relies on the single TooltipProvider mounted in the root layout. The
// portal and content mount on first open and stay mounted afterwards, so
// untouched tooltips cost only a trigger and Radix can still play its
// exit animation.
export default function Tooltip({ children, content, delayDuration = 200 }: TooltipProps) {
  const [hasOpened, setHasOpened] = useState(false)

  return (
    <TooltipPrimitive.Root
      delayDuration={delayDuration}
      onOpenChange={(open) => {
        if (open) setHasOpened(true)
      }}
    >
      <TooltipPrimitive.Trigger asChild>
        {children}
      </TooltipPrimitive.Trigger>
      {hasOpened && (
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            className="z-50 overflow-hidden rounded-md border border-card-border bg-card-background px-3 py-1.5 text-sm text-foreground shadow-md animate-in fade-in-0 zoom-in-95"
            sideOffset={5}
          >
            {content}
            <TooltipPrimitive.Arrow className="fill-card-border" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      )}
    </TooltipPrimitive.Root>
  )
}
