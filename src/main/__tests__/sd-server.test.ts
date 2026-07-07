/**
 * Pure-helper tests for the persistent sd-server client. These lock the two
 * things that silently broke during bring-up:
 *   1. steps/method/guidance MUST be nested under `sample_params` — a top-level
 *      `sample_steps` is ignored by sd-server (it falls back to 20 steps), which
 *      is how an intended 4-step request quietly ran at 20.
 *   2. the finished image lives at result.images[0].b64_json.
 * Payloads mirror real sd-server responses captured during bring-up.
 */
import { describe, it, expect } from 'vitest';
import {
  buildSdServerContextArgs,
  contextKey,
  buildImgGenRequest,
  parseJobResult,
} from '../sd-server';

describe('buildSdServerContextArgs', () => {
  it('builds launch args with model, port, threads and flash-attn', () => {
    const args = buildSdServerContextArgs({ modelPath: '/m/x.gguf', port: 8440, threads: 8, diffusionFa: true });
    expect(args).toEqual(['-m', '/m/x.gguf', '--listen-port', '8440', '--diffusion-fa', '-t', '8']);
  });

  it('omits --diffusion-fa when not requested', () => {
    expect(buildSdServerContextArgs({ modelPath: '/m/x.gguf', port: 8440, threads: 4 }))
      .toEqual(['-m', '/m/x.gguf', '--listen-port', '8440', '-t', '4']);
  });

  it('adds --taesd when a fast-VAE decoder path is given', () => {
    const args = buildSdServerContextArgs({ modelPath: '/m/x.gguf', port: 8440, threads: 4, taesdPath: '/m/taesdxl.safetensors' });
    expect(args).toEqual(['-m', '/m/x.gguf', '--listen-port', '8440', '--taesd', '/m/taesdxl.safetensors', '-t', '4']);
  });
});

describe('contextKey', () => {
  it('changes when the model changes (forces a server restart)', () => {
    const a = contextKey({ modelPath: '/m/a.gguf', port: 8440 });
    const b = contextKey({ modelPath: '/m/b.gguf', port: 8440 });
    expect(a).not.toBe(b);
  });
  it('is stable for the same config', () => {
    const cfg = { modelPath: '/m/a.gguf', diffusionFa: true, threads: 8, port: 8440 };
    expect(contextKey(cfg)).toBe(contextKey({ ...cfg }));
  });
  it('changes when taesd is toggled (forces a restart to add/remove the decoder)', () => {
    const base = { modelPath: '/m/a.gguf', port: 8440 };
    expect(contextKey(base)).not.toBe(contextKey({ ...base, taesdPath: '/m/taesdxl.safetensors' }));
  });
});

describe('buildImgGenRequest', () => {
  it('nests steps/method/guidance under sample_params (NOT top-level)', () => {
    const body = buildImgGenRequest({ prompt: 'a cat', width: 512, height: 512, steps: 4, cfgScale: 1, sampleMethod: 'euler' });
    expect(body).not.toHaveProperty('sample_steps');
    const sp = body.sample_params as Record<string, unknown>;
    expect(sp.sample_steps).toBe(4);
    expect(sp.sample_method).toBe('euler');
    expect(sp.guidance).toEqual({ txt_cfg: 1 });
    expect(body.width).toBe(512);
    expect(body.prompt).toBe('a cat');
  });

  it('applies fast defaults (512, 4 steps, euler, cfg 1) when unspecified', () => {
    const body = buildImgGenRequest({ prompt: 'x' });
    expect(body.width).toBe(512);
    expect(body.height).toBe(512);
    const sp = body.sample_params as Record<string, unknown>;
    expect(sp.sample_steps).toBe(4);
    expect(sp.guidance).toEqual({ txt_cfg: 1 });
  });

  it('sends a concrete seed, but omits it when -1 (random)', () => {
    expect(buildImgGenRequest({ prompt: 'x', seed: 42 }).seed).toBe(42);
    expect(buildImgGenRequest({ prompt: 'x', seed: -1 })).not.toHaveProperty('seed');
    expect(buildImgGenRequest({ prompt: 'x' })).not.toHaveProperty('seed');
  });
});

describe('parseJobResult', () => {
  it('extracts the PNG from a completed job', () => {
    const out = parseJobResult({ status: 'completed', result: { images: [{ b64_json: 'QUJD', index: 0 }], output_format: 'png' } });
    expect(out).toEqual({ done: true, ok: true, pngBase64: 'QUJD', progress: undefined });
  });

  it('flags a completed-but-empty job as a failure (no silent success)', () => {
    const out = parseJobResult({ status: 'completed', result: { images: [] } });
    expect(out.done).toBe(true);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/no image/i);
  });

  it('surfaces the server error on a failed job', () => {
    const out = parseJobResult({ status: 'failed', error: 'out of memory' });
    expect(out).toMatchObject({ done: true, ok: false, error: 'out of memory' });
  });

  it('treats queued/running as not-done and forwards progress', () => {
    expect(parseJobResult({ status: 'queued', queue_position: 0 }).done).toBe(false);
    expect(parseJobResult({ status: 'running', progress: 0.5 })).toMatchObject({ done: false, progress: 0.5 });
  });
});
