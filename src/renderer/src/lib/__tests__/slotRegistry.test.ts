// Tests for the component-slot registry seam (bootstrap/slotRegistry.ts).
// Module-level singleton -> each test re-imports fresh for isolation.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentType } from 'react';

type SlotModule = typeof import('../../bootstrap/slotRegistry');

const A = (() => null) as unknown as ComponentType<Record<string, unknown>>;
const B = (() => null) as unknown as ComponentType<Record<string, unknown>>;

async function fresh(): Promise<SlotModule> {
  vi.resetModules();
  return import('../../bootstrap/slotRegistry');
}

describe('slotRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns undefined for an empty slot', async () => {
    const m = await fresh();
    expect(m.getSlot('anything')).toBeUndefined();
  });

  it('registers and retrieves a component by slot name', async () => {
    const m = await fresh();
    m.registerSlot('composer.toolMenu', A);
    expect(m.getSlot('composer.toolMenu')).toBe(A);
  });

  it('a second register of the same slot overwrites the first', async () => {
    const m = await fresh();
    m.registerSlot('app.root', A);
    m.registerSlot('app.root', B);
    // Unlike nav/screen registries, slots are a plain map - last write wins.
    expect(m.getSlot('app.root')).toBe(B);
  });

  it('keeps distinct slots independent', async () => {
    const m = await fresh();
    m.registerSlot('composer.toolMenu', A);
    m.registerSlot('app.root', B);
    expect(m.getSlot('composer.toolMenu')).toBe(A);
    expect(m.getSlot('app.root')).toBe(B);
  });

  it('exposes the canonical slot-name constants', async () => {
    const m = await fresh();
    expect(m.SLOTS.composerToolMenu).toBe('composer.toolMenu');
    expect(m.SLOTS.appRoot).toBe('app.root');
  });
});
