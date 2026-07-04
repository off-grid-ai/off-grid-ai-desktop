import { describe, it, expect } from 'vitest';
import { waitingLabel } from '../chat-labels';

describe('waitingLabel — scope-aware "working…" text', () => {
  it('No-memory (plain chat) must NOT claim to search memory', () => {
    const label = waitingLabel({ noMemory: true, hasProject: false });
    expect(label).toBe('Thinking…');
    expect(label.toLowerCase()).not.toContain('memory'); // the reported bug
  });

  it('All-memory searches your memory', () => {
    expect(waitingLabel({ noMemory: false, hasProject: false })).toBe('Searching your memory…');
  });

  it('a project scopes the search to the project (regardless of noMemory)', () => {
    expect(waitingLabel({ noMemory: false, hasProject: true })).toBe('Searching this project…');
    expect(waitingLabel({ noMemory: true, hasProject: true })).toBe('Searching this project…');
  });
});
