// @vitest-environment jsdom

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { OrbitingCircles } from '../orbiting-circles'

describe('OrbitingCircles', () => {
  it('keeps every item visible at a distinct phase on the shared orbit', () => {
    const { container } = render(
      <div>
        <OrbitingCircles radius={110} duration={30}>
          <span>Chat</span>
          <span>Vision</span>
          <span>Image</span>
        </OrbitingCircles>
      </div>
    )

    const orbitItems = Array.from(
      container.querySelectorAll<HTMLDivElement>('div[style*="animation"]')
    )

    expect(orbitItems).toHaveLength(3)
    expect(orbitItems.map((item) => item.style.getPropertyValue('--angle'))).toEqual([
      '0deg',
      '120deg',
      '240deg'
    ])
    for (const item of orbitItems) {
      expect(item.style.animation).toContain('offgrid-orbit-circles')
      expect(item.style.animation).not.toMatch(/^orbit\s/)
    }
  })
})
