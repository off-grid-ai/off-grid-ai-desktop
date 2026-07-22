// Input-modality tracking so the keyboard focus ring shows ONLY for real keyboard
// navigation, never on a mouse click. Browsers deliberately match :focus-visible on
// text inputs even when clicked, which paints the emerald ring on every field click
// and reads as heavy/noisy. We stamp the last interaction modality on <html> and the
// CSS focus rule (main.css) only draws the ring in keyboard modality.
//
// Only genuine navigation keys flip to keyboard modality — typing letters into a
// mouse-focused field must NOT make the ring pop in, so text-entry keys are ignored.

const NAV_KEYS = new Set([
  'Tab',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
  'PageUp',
  'PageDown',
  'Escape'
])

function setModality(mode: 'keyboard' | 'pointer'): void {
  document.documentElement.dataset.userModality = mode
}

/** Wire global listeners once, before first paint. Capture phase so we see the
 *  interaction before focus settles. */
export function initFocusModality(): void {
  window.addEventListener(
    'keydown',
    (e) => {
      if (NAV_KEYS.has(e.key)) setModality('keyboard')
    },
    true
  )
  window.addEventListener('pointerdown', () => setModality('pointer'), true)
}
