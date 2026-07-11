// Tests for the renderer screen-registry seam (bootstrap/screenRegistry.ts).
// Module-level singleton -> each test re-imports fresh for isolation.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ComponentType } from 'react';

type ScreenModule = typeof import('../../bootstrap/screenRegistry');

const A = (() => null) as unknown as ComponentType<Record<string, unknown>>;
const B = (() => null) as unknown as ComponentType<Record<string, unknown>>;

async function fresh(): Promise<ScreenModule> {
  vi.resetModules();
  return import('../../bootstrap/screenRegistry');
}

describe('screenRegistry', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('starts empty', async () => {
    const m = await fresh();
    expect(m.getRegisteredScreens()).toEqual([]);
    expect(m.getRegisteredScreen('day')).toBeUndefined();
  });

  it('registers and retrieves a screen by name', async () => {
    const m = await fresh();
    m.registerScreen({ name: 'day', component: A });
    expect(m.getRegisteredScreen('day')?.component).toBe(A);
    expect(m.getRegisteredScreens()).toHaveLength(1);
  });

  it('returns undefined for an unregistered name', async () => {
    const m = await fresh();
    m.registerScreen({ name: 'day', component: A });
    expect(m.getRegisteredScreen('replay')).toBeUndefined();
  });

  it('dedupes by name - first registration wins', async () => {
    const m = await fresh();
    m.registerScreen({ name: 'day', component: A });
    m.registerScreen({ name: 'day', component: B });
    expect(m.getRegisteredScreens()).toHaveLength(1);
    expect(m.getRegisteredScreen('day')?.component).toBe(A);
  });

  it('keeps distinct screens in registration order', async () => {
    const m = await fresh();
    m.registerScreen({ name: 'day', component: A });
    m.registerScreen({ name: 'replay', component: B });
    expect(m.getRegisteredScreens().map((s) => s.name)).toEqual(['day', 'replay']);
  });
});
