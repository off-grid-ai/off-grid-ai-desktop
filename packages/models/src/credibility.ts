// Model source credibility. Classifies a HF author as Official creator /
// Verified quantizer / Community, with labels + colors for badges. Shared so
// desktop and mobile rank sources identically.

export type Credibility = 'offgrid' | 'official' | 'verified-quantizer' | 'community';

// HF authors published/curated by Off Grid (our own converted + verified models).
export const OFFGRID_AUTHORS = ['offgrid-ai', 'offgrid'];

export const OFFICIAL_MODEL_AUTHORS: Record<string, string> = {
  'meta-llama': 'Meta',
  microsoft: 'Microsoft',
  google: 'Google',
  Qwen: 'Alibaba',
  mistralai: 'Mistral AI',
  HuggingFaceTB: 'Hugging Face',
  HuggingFaceH4: 'Hugging Face',
  bigscience: 'BigScience',
  EleutherAI: 'EleutherAI',
  tiiuae: 'TII UAE',
  stabilityai: 'Stability AI',
  databricks: 'Databricks',
  THUDM: 'Tsinghua University',
  'baichuan-inc': 'Baichuan',
  internlm: 'InternLM',
  '01-ai': '01.AI',
  'deepseek-ai': 'DeepSeek',
  CohereForAI: 'Cohere',
  allenai: 'Allen AI',
  nvidia: 'NVIDIA',
  apple: 'Apple',
};

export const VERIFIED_QUANTIZERS: Record<string, string> = {
  TheBloke: 'TheBloke',
  bartowski: 'bartowski',
  QuantFactory: 'QuantFactory',
  mradermacher: 'mradermacher',
  'second-state': 'Second State',
  MaziyarPanahi: 'Maziyar Panahi',
  Triangle104: 'Triangle104',
  unsloth: 'Unsloth',
  'ggml-org': 'GGML (HuggingFace)',
  ggerganov: 'Georgi Gerganov',
  // Strong community quantizers (formerly badged separately) — trusted GGUFs.
  'lmstudio-community': 'Community GGUF',
  'lmstudio-ai': 'Community GGUF',
};

export const CREDIBILITY_LABELS: Record<Credibility, { label: string; description: string; color: string }> = {
  offgrid: { label: 'Off Grid', description: 'Curated & converted by Off Grid — verified to run on-device', color: '#34D399' },
  official: { label: 'Official', description: 'From the original model creator', color: '#22C55E' },
  'verified-quantizer': { label: 'Verified', description: 'From a trusted quantization provider', color: '#A78BFA' },
  community: { label: 'Community', description: 'Community contributed model', color: '#64748B' },
};

/** Classify a HF author into a credibility tier. */
export function determineCredibility(author: string): Credibility {
  if (OFFGRID_AUTHORS.includes(author)) return 'offgrid';
  if (author in OFFICIAL_MODEL_AUTHORS) return 'official';
  if (author in VERIFIED_QUANTIZERS) return 'verified-quantizer';
  return 'community';
}
