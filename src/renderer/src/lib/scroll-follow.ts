// Whether the chat should keep following streamed output to the bottom. The rule: follow only while
// the viewport is near the bottom; once the user scrolls up to read, stop following so a stream of
// tokens can't yank them back down. Pure so the decision is unit-tested without a DOM/layout engine.

export interface ScrollMetrics {
  scrollHeight: number
  scrollTop: number
  clientHeight: number
}

/** Pixels between the current viewport bottom and the content bottom. 0 = pinned to the bottom. */
export function distanceFromBottom(m: ScrollMetrics): number {
  return m.scrollHeight - m.scrollTop - m.clientHeight
}

/** How close to the bottom still counts as "following" — a small slack so a nearly-bottom viewport
 *  keeps tracking, but any real scroll-up (a wheel notch is well past this) stops it. */
export const FOLLOW_THRESHOLD_PX = 120

/** True when new content should auto-scroll into view. Above the threshold means the user scrolled
 *  up on purpose — leave them there. */
export function shouldFollowBottom(m: ScrollMetrics, threshold = FOLLOW_THRESHOLD_PX): boolean {
  return distanceFromBottom(m) <= threshold
}
