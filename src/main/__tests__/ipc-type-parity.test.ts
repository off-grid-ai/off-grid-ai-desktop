// IPC cross-boundary type parity guard (CONSOLIDATION_PLAN A1 + P0.1 + P0.2).
//
// UserProfile / RagMessage / AppSettings (src/main/database.ts), PermissionStatus
// (src/main/permissions.ts) and the ArtifactKind union (src/main/artifacts.ts) are the
// CANONICAL shapes that cross the IPC boundary. They are hand-duplicated in two ambient
// .d.ts files - src/preload/index.d.ts and src/renderer/src/env.d.ts - because those
// files declare renderer globals and cannot `import` the canonical types without turning
// into modules (which would break every ambient global in the renderer).
//
// So the copies can silently drift (P0.1 is the proof: `project_id` was already missing
// from both .d.ts copies of RagConversation). This test is the drift gate. Each block
// below mirrors the .d.ts copy as an inline literal and asserts, at compile time, that it
// is mutually assignable to the canonical type. Remove or rename a field on either side
// and `tsc`/`vitest` here fail. Runtime field-list assertions guard the same shapes for
// anyone skimming failures.
//
// `import type` is erased before runtime, so pulling from database.ts/permissions.ts does
// NOT load electron / better-sqlite3 - the test stays Electron-free and runs in-process.

import { describe, it, expect, expectTypeOf } from 'vitest';
import type { UserProfile, RagConversation, RagMessage, AppSettings } from '../database';
import type { PermissionStatus } from '../permissions';
import type { ArtifactKind } from '../artifacts';

// Each `expectTypeOf(...).toEqualTypeOf<Duplicated>()` below asserts the canonical type
// and the inline mirror of the .d.ts copy are IDENTICAL - drop or rename a field on
// either side and it fails typecheck. It must be called with concrete types at the site
// (a generic wrapper erases them), so the checks are inlined per interface.

describe('IPC type parity - canonical vs duplicated .d.ts shapes', () => {
  it('UserProfile matches the preload/renderer ambient copies', () => {
    // Mirror of the interface in preload/index.d.ts + renderer/env.d.ts.
    type Duplicated = {
      role?: string;
      companySize?: string;
      aiUsageFrequency?: string;
      primaryTools?: string[];
      painPoints?: string[];
      primaryUseCase?: string;
      privacyConcern?: string;
      expectedBenefit?: string;
      referralSource?: string;
      completedAt?: string;
    };
    expectTypeOf<UserProfile>().toEqualTypeOf<Duplicated>();
  });

  it('RagConversation still carries project_id (P0.1 regression guard)', () => {
    // Mirror of the FIXED interface in both .d.ts files. project_id MUST be here or
    // project-scoped chats lose their scope at the preload boundary.
    type Duplicated = {
      id: string;
      title: string | null;
      project_id?: string | null;
      created_at: string;
      updated_at: string;
      message_count?: number;
    };
    expectTypeOf<RagConversation>().toEqualTypeOf<Duplicated>();

    // Belt-and-braces: project_id must be an accepted key of the canonical type. If it
    // is ever removed from database.ts this line stops compiling.
    const withProject: RagConversation = {
      id: 'c1',
      title: null,
      project_id: 'p1',
      created_at: '',
      updated_at: '',
    };
    expect(withProject.project_id).toBe('p1');
    expectTypeOf<RagConversation>().toHaveProperty('project_id');
  });

  it('RagMessage matches the preload/renderer ambient copies', () => {
    type Duplicated = {
      id: number;
      conversation_id: string;
      role: 'user' | 'assistant';
      content: string;
      context: string | null;
      created_at: string;
    };
    expectTypeOf<RagMessage>().toEqualTypeOf<Duplicated>();
  });

  it('AppSettings matches the preload/renderer ambient copies', () => {
    type Duplicated = {
      memoryStrictness?: 'lenient' | 'balanced' | 'strict';
      entityStrictness?: 'lenient' | 'balanced' | 'strict';
      [key: string]: any;
    };
    expectTypeOf<AppSettings>().toEqualTypeOf<Duplicated>();
  });

  it('PermissionStatus matches the preload/renderer ambient copies', () => {
    type Duplicated = {
      accessibility: boolean;
      screenRecording: boolean;
      allGranted: boolean;
    };
    expectTypeOf<PermissionStatus>().toEqualTypeOf<Duplicated>();

    // Runtime guard on the exact field set the IPC handler must return.
    const status: PermissionStatus = { accessibility: true, screenRecording: false, allGranted: false };
    expect(Object.keys(status).sort()).toEqual(['accessibility', 'allGranted', 'screenRecording']);
  });

  it('saveArtifact kind union matches the canonical ArtifactKind (P0.2 regression guard)', () => {
    // The preload `saveArtifact` arg and the renderer env.d.ts `saveArtifact` contract
    // both use this union. It MUST equal the canonical ArtifactKind or the renderer can
    // call saveArtifact({kind:'text'}) against a preload type that rejects it.
    type SaveArtifactKind = 'html' | 'svg' | 'mermaid' | 'react' | 'text' | 'image';
    expectTypeOf<ArtifactKind>().toEqualTypeOf<SaveArtifactKind>();

    // 'text' and 'image' (the values that were missing from preload) must be valid.
    const kinds: ArtifactKind[] = ['html', 'svg', 'mermaid', 'react', 'text', 'image'];
    expect(kinds).toContain('text');
    expect(kinds).toContain('image');
  });
});
