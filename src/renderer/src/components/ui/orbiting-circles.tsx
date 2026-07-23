'use client'

import { cn } from '../../lib/utils'
import React from 'react'

export interface OrbitingCirclesProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string
  children?: React.ReactNode
  reverse?: boolean
  duration?: number
  delay?: number
  radius?: number
  path?: boolean
  iconSize?: number
  speed?: number
}

export function OrbitingCircles({
  className,
  children,
  reverse = false,
  duration = 20,
  delay = 10,
  radius = 160,
  path = true,
  iconSize = 30,
  speed = 1,
  ...props
}: OrbitingCirclesProps): React.JSX.Element {
  const calculatedDuration = duration / speed
  const childCount = React.Children.count(children)

  return (
    <>
      {path && (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          version="1.1"
          className="pointer-events-none absolute inset-0 size-full"
        >
          <circle className="stroke-white/10 stroke-1" cx="50%" cy="50%" r={radius} fill="none" />
        </svg>
      )}
      {React.Children.map(children, (child, index) => {
        const angle = (360 / childCount) * index
        // Distribute by --angle ONLY. A per-index animationDelay would ALSO shift
        // each child along the orbit, and with common delay/duration combos that
        // offset nearly cancels the angle spacing — collapsing the ring into a
        // pile. Keep delay at 0 so the cards stay evenly spaced as the ring turns.
        void delay

        return (
          <div
            style={{
              position: 'absolute',
              width: iconSize,
              height: iconSize,
              animation: `offgrid-orbit-circles ${calculatedDuration}s linear infinite ${reverse ? 'reverse' : 'normal'}`,
              animationDelay: '0s',
              // Start position - each icon at different angle
              transform: `rotate(${angle}deg) translateY(-${radius}px) rotate(-${angle}deg)`,
              // CSS custom properties for keyframes
              ['--radius' as string]: `${radius}px`,
              ['--angle' as string]: `${angle}deg`
            }}
            className={cn('flex transform-gpu items-center justify-center', className)}
            {...props}
          >
            {child}
          </div>
        )
      })}
    </>
  )
}
