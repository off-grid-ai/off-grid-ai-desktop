// WhisperCliTranscription — the only TranscriptionService implementation today.
// Wraps the bundled whisper-cli + ffmpeg. The binary/model resolvers live here
// (extractors.ts re-exports them for back-compat) so model selection and the
// ffmpeg 16 kHz-mono re-encode are defined once and reused by dictation interim
// ticks, final passes, file ingest, and meeting transcription alike.

import { execFile } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { getActiveModal } from '../active-models';
import { binRoots, modelsDir } from '../runtime-env';
import type { TranscriptionService, Transcript, TranscribeOptions } from './types';

const execFileAsync = promisify(execFile);

function existing(paths: string[]): string | null {
  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return p;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Resolve the bundled whisper-cli across dev / packaged layouts. */
export function whisperBin(): string | null {
  return existing(binRoots().map((r) => path.join(r, 'whisper', 'whisper-cli')));
}

/** Resolve ffmpeg: bundled first, then common system locations. */
export function ffmpegBin(): string | null {
  return existing([
    ...binRoots().map((r) => path.join(r, 'ffmpeg')),
    '/opt/homebrew/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
    '/usr/bin/ffmpeg',
  ]);
}

/** List downloaded whisper ggml models (filenames) in the user's models dir. */
function whisperModelFiles(): string[] {
  try {
    return fs.readdirSync(modelsDir()).filter((f) => /^ggml-.*\.bin$/i.test(f));
  } catch {
    return [];
  }
}

/** Rank a model filename by capability/size (bigger = more accurate, slower). */
function sizeRank(f: string): number {
  return /large/i.test(f) ? 4 : /medium/i.test(f) ? 3 : /small/i.test(f) ? 2 : /base/i.test(f) ? 1 : 0;
}

/** Find the model to use for accurate (final) transcription. Prefers a
 *  MULTILINGUAL model (`.en` models are English-only) and a more capable size. */
export function whisperModel(): string | null {
  try {
    const dir = modelsDir();
    // User-chosen transcription model wins, when it's actually present on disk.
    const chosen = getActiveModal('transcription');
    if (chosen && fs.existsSync(path.join(dir, chosen))) return path.join(dir, chosen);
    const files = whisperModelFiles();
    if (!files.length) return null;
    const multi = files.filter((f) => !/\.en\.bin$/i.test(f));
    const pool = multi.length ? multi : files;
    const pick = [...pool].sort((a, b) => sizeRank(b) - sizeRank(a))[0];
    return path.join(dir, pick);
  } catch {
    return null; // transient fs/store error → "no model", not a thrown exception
  }
}

/** Smallest available model — used for fast, display-only dictation interim
 *  ticks where latency matters more than accuracy. Falls back to whisperModel(). */
export function smallWhisperModel(): string | null {
  const files = whisperModelFiles();
  if (!files.length) return null;
  const multi = files.filter((f) => !/\.en\.bin$/i.test(f));
  const pool = multi.length ? multi : files;
  const pick = [...pool].sort((a, b) => sizeRank(a) - sizeRank(b))[0]; // smallest first
  return path.join(modelsDir(), pick);
}

/** Resolve an opts.model (abs path or filename in modelsDir) to an absolute path. */
function resolveModel(model?: string): string | null {
  if (!model) return whisperModel();
  if (path.isAbsolute(model) && fs.existsSync(model)) return model;
  const inDir = path.join(modelsDir(), model);
  if (fs.existsSync(inDir)) return inDir;
  return whisperModel();
}

export class WhisperCliTranscription implements TranscriptionService {
  isAvailable(): boolean {
    return !!whisperBin() && !!whisperModel() && !!ffmpegBin();
  }

  async transcribe(input: { path: string }, opts: TranscribeOptions = {}): Promise<Transcript> {
    const bin = whisperBin();
    if (!bin) throw new Error('Transcription runtime (whisper) is not installed.');
    const model = resolveModel(opts.model);
    if (!model) throw new Error('No transcription model found — download Whisper from Models first.');

    const language = opts.language ?? 'auto';
    const suppress = opts.suppressNonSpeech !== false;

    let wav = input.path;
    let tmp: string | null = null;
    if (!opts.alreadyWav16k) {
      const ff = ffmpegBin();
      if (!ff) throw new Error('ffmpeg is required to decode audio and was not found.');
      tmp = path.join(os.tmpdir(), `offgrid-stt-${Date.now()}-${Math.round(performance.now())}-${process.pid}.wav`);
      // 16 kHz mono PCM WAV; -vn drops any video track so A/V files work too.
      // Cap the decode so a malformed/streaming input can't hang the process forever.
      await execFileAsync(ff, ['-y', '-i', input.path, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', tmp], { timeout: 10 * 60_000 });
      wav = tmp;
    }

    try {
      const args = ['-m', model, '-f', wav, '-l', language, '-nt', '-np'];
      // -mc 0 + -sns: kill the repetition/hallucination loop + non-speech tokens.
      if (suppress) args.push('-mc', '0', '-sns');
      // Bias toward custom vocabulary (names/jargon) via the initial prompt.
      const prompt = (opts.prompt ?? '').trim();
      if (prompt) args.push('--prompt', prompt.slice(0, 800));
      const { stdout } = await execFileAsync(bin, args, { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000 });
      return { text: stdout.trim(), language: language === 'auto' ? undefined : language };
    } finally {
      if (tmp) fs.promises.unlink(tmp).catch(() => {});
    }
  }
}

/** Shared singleton — callers depend on this, not on the class. */
export const transcriptionService: TranscriptionService = new WhisperCliTranscription();
