// Hugging Face integration: search the GGUF model hub and resolve a repo into a
// downloadable ModelEntry (pick a Q4_K_M weight + matching mmproj for vision).
// fetch is injectable so this is unit-testable without the network.

import type { ModelEntry, ModelFile, ModelKind } from './types';
import { QUANTIZATION_INFO, extractQuantization, isMMProjFile } from './quant';
import { determineCredibility, type Credibility } from './credibility';
import { getModelType } from './filters';

// HF pipeline_tag per Off Grid modality — so a tab's search only returns models
// of that kind (text-gen, VLM, diffusion, ASR, TTS) instead of everything.
const KIND_PIPELINE: Record<ModelKind, string> = {
  text: 'text-generation',
  vision: 'image-text-to-text',
  image: 'text-to-image',
  voice: 'text-to-speech',
  transcription: 'automatic-speech-recognition',
};
// Runtimes that consume GGUF (llama.cpp text/vision, sd.cpp image). Whisper (STT)
// is ggml .bin and Kokoro (TTS) is onnx, so we don't constrain those to gguf.
const GGUF_KINDS: ReadonlySet<ModelKind> = new Set(['text', 'vision', 'image']);

const HF = 'https://huggingface.co';
const HF_API = 'https://huggingface.co/api';

type FetchLike = (url: string, init?: { headers?: Record<string, string> }) => Promise<{
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}>;

const defaultFetch: FetchLike = (url, init) => fetch(url, init) as unknown as ReturnType<FetchLike>;

export interface HFSearchResult {
  id: string;
  name: string;
  org: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  credibility: Credibility;
}

/** A selectable quantization variant within a HF repo (for the file picker). */
export interface ModelFileVariant {
  fileName: string;
  quant: string;
  quality: string;
  recommended: boolean;
  sizeBytes: number;
  downloadUrl: string;
  /** Matched vision projector for this weight, when the repo is multimodal. */
  mmproj?: { fileName: string; url: string; sizeBytes?: number };
}

interface HFModel {
  id?: string;
  modelId?: string;
  downloads?: number;
  likes?: number;
  lastModified?: string;
  siblings?: { rfilename: string; size?: number }[];
}

const isMmproj = (name: string): boolean => /mmproj|clip/i.test(name);
const baseName = (p: string): string => p.split('/').pop() ?? p;

/** Search the HF hub for models, scoped to a modality (kind) when given so each
 *  tab only surfaces models it can actually use. */
export async function searchHuggingFace(
  query: string,
  opts: { limit?: number; sort?: string; kind?: ModelKind; fetchImpl?: FetchLike } = {}
): Promise<HFSearchResult[]> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const kind = opts.kind;
  const params = new URLSearchParams({
    sort: opts.sort ?? 'downloads',
    direction: '-1',
    // Over-fetch so post-filtering by detected type still leaves a full page.
    limit: String((opts.limit ?? 30) * 2),
  });
  // GGUF kinds (text/vision/image): constrain to gguf and scope by the NAME
  // heuristic below — HF's pipeline_tag is unreliable on gguf repos (it tags
  // plain text models as image-text-to-text). Non-gguf kinds (ASR/TTS) have no
  // name signal, so lean on HF's pipeline_tag, which is accurate for them.
  if (!kind || GGUF_KINDS.has(kind)) params.set('filter', 'gguf');
  else if (kind) params.set('pipeline_tag', KIND_PIPELINE[kind]);
  if (query) params.set('search', query);
  const res = await fetchImpl(`${HF_API}/models?${params.toString()}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Hugging Face search failed: HTTP ${res.status}`);
  const data = (await res.json()) as HFModel[];
  let out = data.map((m) => {
    const id = m.id ?? m.modelId ?? '';
    const org = id.split('/')[0] ?? '';
    return { id, name: baseName(id), org, downloads: m.downloads, likes: m.likes, lastModified: m.lastModified, credibility: determineCredibility(org) };
  });
  // HF's pipeline tags are inconsistent for gguf repos, so refine text/vision/image
  // by the name heuristic too (e.g. keep VLMs off the Text tab and vice versa).
  if (kind === 'text') out = out.filter((m) => { const t = getModelType(m.name); return t === 'text' || t === 'code'; });
  else if (kind === 'vision') out = out.filter((m) => getModelType(m.name) === 'vision');
  else if (kind === 'image') out = out.filter((m) => getModelType(m.name) === 'image-gen');
  return out.slice(0, opts.limit ?? 30);
}

/** List a repo's GGUF quantization variants (with matched mmproj), for a file
 * picker. Sorted recommended-first, then smallest. */
export async function getModelFiles(
  repoId: string,
  opts: { fetchImpl?: FetchLike } = {}
): Promise<ModelFileVariant[]> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const res = await fetchImpl(`${HF_API}/models/${repoId}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return [];
  const data = (await res.json()) as HFModel;
  const gguf = (data.siblings ?? []).filter((f) => f.rfilename.endsWith('.gguf'));
  const mmprojFiles = gguf.filter((f) => isMMProjFile(f.rfilename));
  const weights = gguf.filter((f) => !isMMProjFile(f.rfilename));
  const url = (rf: string): string => `${HF}/${repoId}/resolve/main/${rf}`;

  const matchMmproj = (weightName: string): ModelFileVariant['mmproj'] | undefined => {
    if (mmprojFiles.length === 0) return undefined;
    const wq = extractQuantization(weightName);
    const exact = wq !== 'Unknown' ? mmprojFiles.find((f) => extractQuantization(f.rfilename) === wq) : undefined;
    const f16 = mmprojFiles.find((f) => {
      const l = f.rfilename.toLowerCase();
      return (l.includes('f16') || l.includes('fp16')) && !l.includes('bf16');
    });
    const pick = exact ?? f16 ?? mmprojFiles[0];
    return { fileName: baseName(pick.rfilename), url: url(pick.rfilename), sizeBytes: pick.size };
  };

  return weights
    .map((f) => {
      const quant = extractQuantization(f.rfilename);
      const info = QUANTIZATION_INFO[quant];
      return {
        fileName: baseName(f.rfilename),
        quant,
        quality: info?.quality ?? 'Unknown',
        recommended: info?.recommended ?? false,
        sizeBytes: f.size ?? 0,
        downloadUrl: url(f.rfilename),
        mmproj: matchMmproj(f.rfilename),
      };
    })
    .sort((a, b) => Number(b.recommended) - Number(a.recommended) || a.sizeBytes - b.sizeBytes);
}

/**
 * Resolve a HF repo into a downloadable ModelEntry: a primary GGUF (preferring
 * Q4_K_M) plus a matching mmproj when the repo is multimodal. Returns null if no
 * usable GGUF is found.
 */
export async function resolveHuggingFaceModel(
  repoId: string,
  opts: { kind?: ModelKind; fetchImpl?: FetchLike } = {}
): Promise<ModelEntry | null> {
  const fetchImpl = opts.fetchImpl ?? defaultFetch;
  const res = await fetchImpl(`${HF_API}/models/${repoId}`, { headers: { Accept: 'application/json' } });
  if (!res.ok) return null;
  const data = (await res.json()) as HFModel;
  const siblings = data.siblings ?? [];
  const url = (rf: string): string => `${HF}/${repoId}/resolve/main/${rf}`;
  const org = repoId.split('/')[0];

  // Non-GGUF runtimes our pipeline already supports: whisper transcription reads
  // ggml `.bin`; Kokoro/Piper TTS read `.onnx`. Detect these first so a search →
  // download works for them, not just llama.cpp GGUF models.
  const ggml = siblings.filter((f) => /ggml.*\.bin$/i.test(f.rfilename));
  if (ggml.length > 0) {
    // Prefer the multilingual base (good speed/quality default), else smallest.
    const pick = ggml.find((f) => /ggml-base\.bin$/i.test(f.rfilename))
      ?? [...ggml].sort((a, b) => (a.size ?? 0) - (b.size ?? 0))[0];
    return {
      id: repoId, name: baseName(repoId), kind: 'transcription', org,
      files: [{ name: baseName(pick.rfilename), url: url(pick.rfilename), sizeBytes: pick.size, role: 'primary' }],
    };
  }
  const onnx = siblings.filter((f) => /\.onnx$/i.test(f.rfilename));
  if (onnx.length > 0 && siblings.every((f) => !f.rfilename.endsWith('.gguf'))) {
    const pick = onnx.find((f) => /quant/i.test(f.rfilename)) ?? onnx[0];
    const files: ModelFile[] = [{ name: baseName(pick.rfilename), url: url(pick.rfilename), sizeBytes: pick.size, role: 'primary' }];
    // Piper voices ship a sidecar <name>.onnx.json the runtime needs.
    const cfg = siblings.find((f) => f.rfilename === `${pick.rfilename}.json`);
    if (cfg) files.push({ name: baseName(cfg.rfilename), url: url(cfg.rfilename), sizeBytes: cfg.size, role: 'aux' });
    return { id: repoId, name: baseName(repoId), kind: 'voice', org, files };
  }

  const gguf = siblings.filter((f) => f.rfilename.endsWith('.gguf'));
  if (gguf.length === 0) return null;

  const weights = gguf.filter((f) => !isMmproj(f.rfilename));
  const mmprojFiles = gguf.filter((f) => isMmproj(f.rfilename));
  const primary = weights.find((f) => /q4_k_m/i.test(f.rfilename)) ?? weights[0] ?? gguf[0];
  if (!primary) return null;

  const files: ModelFile[] = [
    { name: baseName(primary.rfilename), url: url(primary.rfilename), sizeBytes: primary.size, role: 'primary' },
  ];
  if (mmprojFiles[0]) {
    files.push({ name: baseName(mmprojFiles[0].rfilename), url: url(mmprojFiles[0].rfilename), sizeBytes: mmprojFiles[0].size, role: 'mmproj' });
  }

  return {
    id: repoId,
    name: baseName(repoId),
    kind: mmprojFiles.length ? 'vision' : (opts.kind ?? 'text'),
    org,
    files,
  };
}
