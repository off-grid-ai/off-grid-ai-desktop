// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { ModelPicker } from '../ModelPicker'

// Stub only the device/IPC boundary (window.api); the component's grid/detail logic runs real.
function stubApi(): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).api = {
    isPro: true,
    getModelCatalog: async () => ({
      models: [{ id: 'gemma', name: 'Gemma 4 E2B', kind: 'text', files: [{ name: 'gemma.gguf', role: 'primary' }] }]
    }),
    getInstalledModels: async () => ['gemma'],
    getActiveModel: async () => 'gemma',
    getActiveModalities: async () => ({}),
    setActiveModel: async () => {},
    unloadRuntime: async () => true
  }
}

describe('ModelPicker — grid with L2 detail', () => {
  beforeEach(stubApi)
  afterEach(() => {
    cleanup()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(window as any).api = undefined
  })

  it('shows models in a grid, opens an L2 detail on click, and goes back', async () => {
    render(<ModelPicker onClose={() => {}} />)

    // Grid: the model card renders (marked Active since it is the active selection).
    const card = await screen.findByText('Gemma 4 E2B')
    expect(screen.getByText('Active')).toBeTruthy()

    // Click → L2 detail: shows the model's files + an Unload action (it's active).
    fireEvent.click(card)
    await waitFor(() => expect(screen.getByText('gemma.gguf')).toBeTruthy())
    expect(screen.getByText('Files')).toBeTruthy()
    expect(screen.getByText('Unload')).toBeTruthy()

    // Back (the modality label button) returns to the grid.
    fireEvent.click(screen.getByText('Text & Vision'))
    await waitFor(() => expect(screen.getByText('Gemma 4 E2B')).toBeTruthy())
    expect(screen.queryByText('Files')).toBeNull()
  })
})
