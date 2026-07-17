// Compile-time and source-contract guards for IPC types shared by main and renderer.

import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, it, expect, expectTypeOf } from 'vitest'
import type { UserProfile, RagConversation, RagMessage } from '../database'
import type { PermissionStatus } from '../permissions'
import type { ArtifactKind } from '../artifacts'
import type {
  ArtifactKindContract,
  PermissionStatusContract,
  RagConversationContract,
  RagMessageContract,
  UserProfileContract
} from '../../shared/ipc-contracts'

const rendererContract = readFileSync(resolve(process.cwd(), 'src/renderer/src/env.d.ts'), 'utf8')

describe('IPC type parity - renderer API vs shared contracts', () => {
  it('keeps main-process exports on the shared contract', () => {
    expectTypeOf<UserProfile>().toEqualTypeOf<UserProfileContract>()
    expectTypeOf<RagConversation>().toEqualTypeOf<RagConversationContract>()
    expectTypeOf<RagMessage>().toEqualTypeOf<RagMessageContract>()
    expectTypeOf<PermissionStatus>().toEqualTypeOf<PermissionStatusContract>()
    expectTypeOf<ArtifactKind>().toEqualTypeOf<ArtifactKindContract>()
  })

  it('keeps renderer aliases on the shared contract owner', () => {
    expect(rendererContract).toContain(
      "type UserProfile = import('../../shared/ipc-contracts').UserProfileContract"
    )
    expect(rendererContract).toContain(
      "type RagConversation = import('../../shared/ipc-contracts').RagConversationContract"
    )
    expect(rendererContract).toContain(
      "type RagMessage = import('../../shared/ipc-contracts').RagMessageContract"
    )
    expect(rendererContract).toContain(
      "type OffGridPermissionStatus = import('../../shared/ipc-contracts').PermissionStatusContract"
    )
    expect(rendererContract).toContain(
      "type ArtifactKind = import('../../shared/ipc-contracts').ArtifactKindContract"
    )
  })

  it('keeps project scope on RAG conversations', () => {
    const withProject: RagConversation = {
      id: 'c1',
      title: null,
      project_id: 'p1',
      created_at: '',
      updated_at: ''
    }
    expect(withProject.project_id).toBe('p1')
  })

  it('keeps all supported artifact kinds', () => {
    const kinds: ArtifactKind[] = ['html', 'svg', 'mermaid', 'react', 'text', 'image']
    expect(kinds).toContain('text')
    expect(kinds).toContain('image')
  })
})
