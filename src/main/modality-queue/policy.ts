// Pure scheduling policy for the ModalityQueue — zero IO, so the priority rules are
// unit-tested in isolation from the async lock + model-eviction that wrap them.
//
// Tiers (lower number = higher priority):
//   1 = live transcription (dictation), 2 = interactive foreground (chat, image,
//   TTS, file STT), 3 = background rewind/replay vision (always yields).
//
// Rules: one heavy (tier-2/3) job at a time; when the slot frees the highest-priority
// waiter runs next (FIFO within a tier); tier 3 only starts when nothing in tier 1/2
// runs OR waits; tier 1 is light and MAY coexist with a running tier-2 job when
// tier1CoexistsWithTier2 is set (default) so speech never stalls behind foreground.

export type Tier = 1 | 2 | 3;

export interface QueueJob {
  id: string;
  tier: Tier;
  label: string;
  seq: number;
}

export interface PolicyConfig {
  tier1CoexistsWithTier2: boolean;
}

export const DEFAULT_POLICY: PolicyConfig = { tier1CoexistsWithTier2: true };

export function byPriority(a: QueueJob, b: QueueJob): number {
  return a.tier - b.tier || a.seq - b.seq;
}

export function canRun(candidate: QueueJob, running: readonly QueueJob[], cfg: PolicyConfig): boolean {
  if (running.some((r) => r.tier === candidate.tier && candidate.tier === 1)) return false;
  const heavyRunning = running.some((r) => r.tier === 2 || r.tier === 3);
  if (candidate.tier === 3) return running.length === 0;
  if (candidate.tier === 2) return !heavyRunning;
  return !heavyRunning || cfg.tier1CoexistsWithTier2;
}

export function selectNext(
  running: readonly QueueJob[],
  waiting: readonly QueueJob[],
  cfg: PolicyConfig = DEFAULT_POLICY,
): QueueJob | null {
  const foregroundPending = waiting.some((j) => j.tier === 1 || j.tier === 2);
  const ordered = [...waiting].sort(byPriority);
  for (const job of ordered) {
    if (job.tier === 3 && foregroundPending) continue;
    if (canRun(job, running, cfg)) return job;
  }
  return null;
}
