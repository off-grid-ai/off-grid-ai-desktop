import { describe, it, expect } from 'vitest'
import { distanceFromBottom, shouldFollowBottom, FOLLOW_THRESHOLD_PX } from '../scroll-follow'

describe('scroll-follow', () => {
  it('measures distance from the bottom', () => {
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(0)
    expect(distanceFromBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 200 })).toBe(500)
  })

  it('follows when pinned to the bottom', () => {
    expect(shouldFollowBottom({ scrollHeight: 1000, scrollTop: 800, clientHeight: 200 })).toBe(true)
  })

  it('keeps following within the slack threshold (nearly bottom)', () => {
    // 100px from the bottom (< 120) still tracks.
    expect(shouldFollowBottom({ scrollHeight: 1000, scrollTop: 700, clientHeight: 200 })).toBe(true)
  })

  it('stops following once the user scrolls up past the threshold', () => {
    // 500px up — the user is reading; a token must NOT yank them down.
    expect(shouldFollowBottom({ scrollHeight: 1000, scrollTop: 300, clientHeight: 200 })).toBe(false)
  })

  it('honors a custom threshold', () => {
    const m = { scrollHeight: 1000, scrollTop: 750, clientHeight: 200 } // 50px from bottom
    expect(shouldFollowBottom(m, 40)).toBe(false)
    expect(shouldFollowBottom(m, 60)).toBe(true)
  })

  it('exposes a small default slack', () => {
    expect(FOLLOW_THRESHOLD_PX).toBeGreaterThan(0)
    expect(FOLLOW_THRESHOLD_PX).toBeLessThan(400)
  })
})
