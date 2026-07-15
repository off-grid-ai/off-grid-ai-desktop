// D10 — a streamed chat must honor the caller's requested max_tokens, not silently
// cap at the persisted setting. chatStream once built `this.maxTokens || maxTokens`,
// so the setting (always truthy) won and the caller's value was DEAD. The rule now
// lives in resolveMaxTokens, shared by all three chat entry points.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { join } from 'path';
import { resolveMaxTokens } from '../gen-params';

describe('resolveMaxTokens (D10)', () => {
  it('honors an explicit per-call request over the setting', () => {
    // The exact case the old `setting || requested` got wrong: a turn asking for
    // more than the setting must NOT be truncated to the setting.
    expect(resolveMaxTokens(4096, 2048)).toBe(4096);
    expect(resolveMaxTokens(200, 2048)).toBe(200);
  });

  it('falls back to the persisted setting when the caller omits it', () => {
    expect(resolveMaxTokens(undefined, 2048)).toBe(2048);
    expect(resolveMaxTokens(undefined, 4096)).toBe(4096);
  });
});

describe('llm.ts routes every chat path through resolveMaxTokens (no divergence)', () => {
  const src = readFileSync(join(__dirname, '..', '..', 'llm.ts'), 'utf8');

  it('no longer contains the buggy `this.maxTokens || <caller>` precedence', () => {
    // Regression guard: this exact pattern is what made the caller's value dead.
    expect(src).not.toMatch(/this\.maxTokens\s*\|\|/);
  });

  it('builds every max_tokens via resolveMaxTokens', () => {
    const maxTokenLines = src.split('\n').filter((l) => /max_tokens:/.test(l));
    expect(maxTokenLines.length).toBeGreaterThanOrEqual(3); // chat, chatStream, streamChat
    for (const line of maxTokenLines) {
      expect(line).toMatch(/resolveMaxTokens\(/);
    }
  });
});
