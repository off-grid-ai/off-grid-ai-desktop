'use client'

import * as React from 'react'
import { cn } from '@renderer/lib/utils'

type ItemVariant = 'default' | 'outline' | 'muted'
type ItemSize = 'default' | 'sm'

const itemVariants: Record<ItemVariant, string> = {
  default: 'border border-neutral-800 bg-neutral-900/50 hover:bg-neutral-900/80',
  outline: 'border border-neutral-800 bg-transparent hover:bg-neutral-900/30',
  muted: 'border border-neutral-800/60 bg-neutral-900/30 hover:bg-neutral-900/60'
}

const itemSizes: Record<ItemSize, string> = {
  default: 'p-4',
  sm: 'p-2.5'
}

export const Item = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: ItemVariant
    size?: ItemSize
  }
>(({ className, variant = 'default', size = 'default', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative flex w-full items-center gap-4 rounded-xl transition-colors',
      itemVariants[variant],
      itemSizes[size],
      className
    )}
    {...props}
  />
))
Item.displayName = 'Item'

export const ItemGroup = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex flex-col gap-3', className)} {...props} />
  )
)
ItemGroup.displayName = 'ItemGroup'

export const ItemSeparator = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('h-px w-full bg-neutral-800', className)} {...props} />
  )
)
ItemSeparator.displayName = 'ItemSeparator'

export const ItemMedia = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & {
    variant?: 'default' | 'icon' | 'image'
  }
>(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'flex items-center justify-center',
      variant === 'image' && 'h-10 w-10 overflow-hidden rounded-lg',
      variant === 'icon' &&
        'h-9 w-9 rounded-lg border border-neutral-800 bg-neutral-900/80 text-neutral-300',
      variant === 'default' && 'h-10 w-10 rounded-lg bg-neutral-800 text-neutral-300',
      className
    )}
    {...props}
  />
))
ItemMedia.displayName = 'ItemMedia'

export const ItemContent = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex min-w-0 flex-1 flex-col gap-1', className)} {...props} />
  )
)
ItemContent.displayName = 'ItemContent'

export const ItemTitle = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-sm font-medium text-white truncate', className)} {...props} />
))
ItemTitle.displayName = 'ItemTitle'

export const ItemDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-xs text-neutral-500 truncate', className)} {...props} />
))
ItemDescription.displayName = 'ItemDescription'

export const ItemActions = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div ref={ref} className={cn('flex items-center gap-2', className)} {...props} />
  )
)
ItemActions.displayName = 'ItemActions'

export const ItemHeader = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('w-full', className)} {...props} />
)
ItemHeader.displayName = 'ItemHeader'

export const ItemFooter = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn('w-full', className)} {...props} />
)
ItemFooter.displayName = 'ItemFooter'
