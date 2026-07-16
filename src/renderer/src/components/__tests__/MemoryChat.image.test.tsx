// @vitest-environment jsdom
//
// TRUE terminal-artifact test for the image-gen drift fix (hygiene §D: assert the
// terminal artifact from the REAL entry point, not a re-implemented state machine).
//
// The terminal artifact is the `window.api.generateImage({...})` payload that crosses
// to the main process. Here we mount the REAL <MemoryChat/> under jsdom, fire REAL DOM
// events (open image mode + options, pick a model in the dropdown, type a steps value,
// type a prompt, click Send), and assert the payload the component actually handed to
// `generateImage`. Unlike the sibling image-params-wiring.test.ts — which replays a
// hand-written replica of the composer's state machine — nothing here re-implements the
// component: if the send path reads a stale local `imgSteps`, if the `[imgModel]` effect
// stops resolving the override, or if the dropdown's onChange stops routing through
// `setActiveModalModel`, this test goes RED because the REAL component produced the
// wrong payload.
//
// The two bugs this guards (both were user-visible):
//   (a) drift — composer showed steps=10 but generate ran the model default (28),
//       because a `[imgModel]` effect re-seeded local state and stomped the typed value.
//   (b) divergence — the composer's model dropdown didn't write through the same owner
//       as the Active-models panel, so the two disagreed on which model ran.

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryChat } from '../MemoryChat'
import { TooltipProvider } from '../ui/tooltip'

// The real app mounts MemoryChat inside a global TooltipProvider (App shell). Mirror
// that here so the composer's tooltip-wrapped controls render — this wraps the REAL
// component, it does not stub any of its behavior.
function renderChat() {
  return render(
    <TooltipProvider>
      <MemoryChat />
    </TooltipProvider>
  )
}

// jsdom lacks ResizeObserver; Radix (tooltip/dropdown) references it at module load.
// Install it once at top-level so an import-time capture sees a real constructor.
;(globalThis as unknown as { ResizeObserver?: unknown }).ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const FEW_STEP = 'sdxl-lightning.gguf' // shared image-defaults: defaultSteps 10
const FULL = 'dreamlike-photoreal-v2.gguf' // shared image-defaults: defaultSteps 28

type GenPayload = {
  steps?: number
  model?: string
  width?: number
  height?: number
  prompt?: string
}

/** Build a full in-process fake of the preload `window.api` bridge. Every method the
 *  component touches on mount / send is stubbed at the TRUE boundary (the IPC bridge),
 *  so the component code under test is 100% real. `generateImage` + `setActiveModalModel`
 *  are the assertion subjects; the rest resolve to inert defaults. */
function installApi(opts: {
  active: string
  models: string[]
  settings?: Record<string, unknown>
}) {
  const settings: Record<string, unknown> = { ...(opts.settings ?? {}) }
  const generateImage = vi.fn(async (_p: GenPayload) => ({
    dataUrl: 'data:image/png;base64,AAAA',
    path: '/tmp/out.png'
  }))
  const setActiveModalModel = vi.fn(async (_kind: string, _model: string) => {})
  // The agentic path's single entry point. Returns a benign text answer with no
  // imageRequest, so if the turn reaches the agent no generateImage call follows —
  // making "generateImage was/ wasn't called" an unambiguous terminal artifact.
  const toolChat = vi.fn(async () => ({ answer: 'done', toolCalls: [], unified: [] }))
  const api = {
    isPro: false,
    // --- assertion subjects ---
    generateImage,
    setActiveModalModel,
    // --- image engine probe (drives imgModels + imgModel on mount) ---
    imageGenStatus: vi.fn(async () => ({
      available: true,
      models: opts.models,
      active: opts.active
    })),
    cancelImageGen: vi.fn(),
    onImageGenProgress: vi.fn(() => () => {}),
    // --- conversation + persistence seams touched by the send path ---
    getRagConversations: vi.fn(async () => []),
    getRagMessages: vi.fn(async () => []),
    createRagConversation: vi.fn(async () => {}),
    addRagMessage: vi.fn(async () => {}),
    saveArtifact: vi.fn(async () => {}),
    // --- settings round-trip (per-model override persistence) ---
    getSettings: vi.fn(async () => settings),
    saveSetting: vi.fn(async (k: string, v: unknown) => {
      settings[k] = v
    }),
    // --- misc mount-time calls (inert) ---
    listProjects: vi.fn(async () => []),
    styleThumbs: vi.fn(async () => ({})),
    listSkills: vi.fn(async () => []),
    onRagStream: vi.fn(() => () => {}),
    toolChat
  }
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return { generateImage, setActiveModalModel, toolChat }
}

/** Drive the composer into image mode with the options panel open. */
async function openImageComposer(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^image$/i }))
  // Turning on image mode reveals the "Image options" toggle (a re-render). Wait for
  // it to mount before clicking, so a cold first-test mount doesn't race the click.
  const opts = await screen.findByRole('button', { name: /image options/i }, { timeout: 3000 })
  await user.click(opts)
}

/** The steps control is a numeric <input min=4 max=50>; find it by its spinbutton role. */
function stepsInput(): HTMLInputElement {
  const spinners = screen.getAllByRole('spinbutton') as HTMLInputElement[]
  // The steps input is the one bounded 4..50 (seed is text; strength is 0..1).
  const steps = spinners.find((el) => el.max === '50' && el.min === '4')
  if (!steps) throw new Error('steps <input min=4 max=50> not found in the image options')
  return steps
}

function typeSteps(value: number) {
  // The steps <input type=number> is controlled and clamps on every keystroke
  // (onChange -> Math.max(4, Math.min(50, …))). A real edit commits one final value;
  // fire a single change event with that value, which is the faithful DOM signal.
  fireEvent.change(stepsInput(), { target: { value: String(value) } })
}

async function sendPrompt(user: ReturnType<typeof userEvent.setup>, prompt: string) {
  const textarea = screen.getByPlaceholderText(/describe an image to generate/i)
  await user.type(textarea, prompt)
  await user.click(screen.getByRole('button', { name: /^send$/i }))
}

describe('<MemoryChat/> image mode — the generateImage payload is the terminal artifact', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    // jsdom has no layout engine. Polyfill the layout APIs MemoryChat + Radix touch so
    // an effect doesn't throw an async ResizeObserver/scroll error that taints the run.
    ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  it('carries the USER-typed steps (10), not the model default (28), and the picked model', async () => {
    const user = userEvent.setup()
    // Engine reports the full checkpoint (default 28) active, plus the few-step one.
    const { generateImage, setActiveModalModel } = installApi({
      active: FULL,
      models: [FULL, FEW_STEP]
    })
    renderChat()

    await openImageComposer(user)
    // Model select must be present (imgModels.length > 1) and reflect the active model.
    const modelSelect = (await screen.findByDisplayValue(
      /dreamlike-photoreal-v2/i,
      {},
      { timeout: 3000 }
    )) as HTMLSelectElement
    expect(modelSelect).toBeTruthy()

    // User overrides steps to 10 (the model's default is 28).
    typeSteps(10)
    await sendPrompt(user, 'a red fox in the snow')

    await waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))
    const payload = generateImage.mock.calls[0]![0] as GenPayload
    // Bug (a): the send path used to hand over the stomped default (28). Assert 10.
    expect(payload.steps).toBe(10)
    expect(payload.steps).not.toBe(28)
    // The model is the active/picked one, carried through to the engine.
    expect(payload.model).toBe(FULL)
    // Bug (b): the composer binds to the shared owner. On mount it reads active; a
    // dropdown change writes through setActiveModalModel (asserted in the next test).
    expect(setActiveModalModel).toBeTruthy()
  })

  it('picking a different model in the dropdown routes through setActiveModalModel and reaches the payload', async () => {
    const user = userEvent.setup()
    const { generateImage, setActiveModalModel } = installApi({
      active: FULL,
      models: [FULL, FEW_STEP]
    })
    renderChat()
    await openImageComposer(user)

    const modelSelect = (await screen.findByDisplayValue(
      /dreamlike-photoreal-v2/i,
      {},
      { timeout: 3000 }
    )) as HTMLSelectElement
    // Switch to the few-step model via a REAL change event on the real <select>.
    await user.selectOptions(modelSelect, FEW_STEP)

    // Divergence fix: the dropdown MUST write through the same owner as the
    // Active-models panel, or the two silently disagree on which model runs.
    await waitFor(() => expect(setActiveModalModel).toHaveBeenCalledWith('image', FEW_STEP))

    await sendPrompt(user, 'a mountain lake')
    await waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))
    const payload = generateImage.mock.calls[0]![0] as GenPayload
    expect(payload.model).toBe(FEW_STEP)
    // Switching to the few-step model with no user override resolves to THAT model's
    // default (10), not a leftover value — proving the [imgModel] effect re-resolves.
    expect(payload.steps).toBe(10)
  })
})

// Send a message in the DEFAULT chat composer (not image mode).
async function sendChat(user: ReturnType<typeof userEvent.setup>, text: string) {
  const textarea = await screen.findByPlaceholderText(/ask anything/i, {}, { timeout: 3000 })
  await user.type(textarea, text)
  await user.click(screen.getByRole('button', { name: /^send$/i }))
}

// Bug 4 (root of the image-gen-as-tool bug): the renderer's keyword auto-route and
// the agent's tool decision both decided "is this an image request?" for the same
// turn. With tools on, "draw ..." was hijacked by the renderer's direct generate,
// so the generate_image TOOL never ran. The terminal artifacts: which IPC the turn
// actually crosses on (toolChat = agent path, generateImage = direct route).
describe('<MemoryChat/> chat mode — image intent is decided in ONE place', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
    ;(Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {}
    ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })

  it('with tools ON, a "draw ..." turn goes to the agent (toolChat), NOT the renderer direct-generate', async () => {
    const user = userEvent.setup()
    // composerToolsOn is persisted in settings and read into toolsOn on mount.
    const { generateImage, toolChat } = installApi({
      active: FULL,
      models: [FULL],
      settings: { composerToolsOn: true }
    })
    renderChat()

    await sendChat(user, 'draw a dog')

    // The turn crossed on the agentic path...
    await waitFor(() => expect(toolChat).toHaveBeenCalledTimes(1))
    // ...and the renderer did NOT pre-decide + fire a direct image generation.
    expect(generateImage).not.toHaveBeenCalled()
  })

  it('with tools OFF, the same "draw ..." turn auto-routes to direct image generation', async () => {
    const user = userEvent.setup()
    const { generateImage, toolChat } = installApi({ active: FULL, models: [FULL] })
    renderChat()

    await sendChat(user, 'draw a dog')

    // No agent in plain chat — the renderer keyword auto-route generates directly.
    await waitFor(() => expect(generateImage).toHaveBeenCalledTimes(1))
    expect(toolChat).not.toHaveBeenCalled()
    const payload = generateImage.mock.calls[0]![0] as GenPayload
    expect(payload.prompt).toBe('a dog') // cleanImagePrompt stripped the verb
  })
})
