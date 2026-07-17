/// <reference path="../../renderer/src/env.d.ts" />

// Compile-time guard that the renderer-facing IPC API uses the canonical main-process
// contracts. env.d.ts references these owners through import() type aliases, so there is
// no hand-copied preload declaration left to drift.

import { describe, it, expect, expectTypeOf } from 'vitest'
import type { UserProfile, RagConversation, RagMessage, AppSettings } from '../database'
import type { PermissionStatus } from '../permissions'
import type { ArtifactKind } from '../artifacts'

describe('IPC type parity - renderer API vs canonical contracts', () => {
  it('uses the canonical user profile at the API boundary', () => {
    expectTypeOf<Parameters<IElectronAPI['saveUserProfile']>[0]>().toEqualTypeOf<UserProfile>()
    expectTypeOf<
      Awaited<ReturnType<IElectronAPI['getUserProfile']>>
    >().toEqualTypeOf<UserProfile | null>()
  })

  it('keeps project scope on RAG conversations', () => {
    expectTypeOf<Awaited<ReturnType<IElectronAPI['getRagConversations']>>>().toEqualTypeOf<
      RagConversation[]
    >()
    const withProject: RagConversation = {
      id: 'c1',
      title: null,
      project_id: 'p1',
      created_at: '',
      updated_at: ''
    }
    expect(withProject.project_id).toBe('p1')
  })

  it('uses the canonical RAG message shape', () => {
    expectTypeOf<Awaited<ReturnType<IElectronAPI['getRagMessages']>>>().toEqualTypeOf<
      RagMessage[]
    >()
  })

  it('uses the canonical app settings shape', () => {
    expectTypeOf<Awaited<ReturnType<IElectronAPI['getSettings']>>>().toEqualTypeOf<AppSettings>()
  })

  it('uses the canonical permission status shape', () => {
    expectTypeOf<
      Awaited<ReturnType<IElectronAPI['getPermissionStatus']>>
    >().toEqualTypeOf<PermissionStatus>()
    const status: PermissionStatus = {
      accessibility: true,
      screenRecording: false,
      allGranted: false
    }
    expect(Object.keys(status).sort()).toEqual(['accessibility', 'allGranted', 'screenRecording'])
  })

  it('uses the canonical artifact kind for saves', () => {
    type SaveArtifactKind = Parameters<IElectronAPI['saveArtifact']>[0]['kind']
    expectTypeOf<SaveArtifactKind>().toEqualTypeOf<ArtifactKind>()
    const kinds: ArtifactKind[] = ['html', 'svg', 'mermaid', 'react', 'text', 'image']
    expect(kinds).toContain('text')
    expect(kinds).toContain('image')
  })
})
