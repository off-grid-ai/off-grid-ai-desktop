// Dictation overlay renderer (#dictation hash route). Free-tier / open-core feature.
// Runs in the small, non-focusable always-on-top window. Owns the mic capture pipeline:
// getUserMedia → AudioWorklet (raw Float32 PCM) → batched chunks streamed to main,
// plus a live RMS level meter, an elapsed timer, and the interim transcript.

import { useEffect, useRef, useState } from 'react';
import { Microphone, Square } from '@phosphor-icons/react';
import { voice } from '@renderer/lib/voiceApi';

// Inline AudioWorklet: posts each input frame (Float32) back to the main thread.
const WORKLET_SRC = `
class PCMWorklet extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch && ch.length) this.port.postMessage(ch.slice(0));
    return true;
  }
}
registerProcessor('pcm-worklet', PCMWorklet);
`;

const TARGET_RATE = 16000;
const FLUSH_SAMPLES = TARGET_RATE / 4; // ~250 ms batches

type Phase = 'recording' | 'transcribing';

export function DictationOverlay(): React.JSX.Element | null {
  const [active, setActive] = useState(false);
  const [phase, setPhase] = useState<Phase>('recording');
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<'hold' | 'toggle' | 'both'>('hold');
  const [accelerator, setAccelerator] = useState('Option+Space');

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const pendingRef = useRef<number[]>([]);
  const rateRef = useRef(TARGET_RATE);
  const startRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const errorHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [interim]);

  async function startCapture(): Promise<void> {
    const v = voice();
    if (!v || ctxRef.current) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: TARGET_RATE });
      ctxRef.current = ctx;
      const blob = new Blob([WORKLET_SRC], { type: 'application/javascript' });
      const url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);

      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, 'pcm-worklet');
      const rate = ctx.sampleRate;
      rateRef.current = rate;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        const frame = e.data;
        let sum = 0;
        for (let i = 0; i < frame.length; i++) sum += frame[i] * frame[i];
        setLevel(Math.min(1, Math.sqrt(sum / frame.length) * 6));
        const pend = pendingRef.current;
        for (let i = 0; i < frame.length; i++) pend.push(frame[i]);
        if (pend.length >= FLUSH_SAMPLES) {
          const batch = new Float32Array(pend.splice(0, pend.length));
          void v.sendChunk(batch, rate);
        }
      };
      src.connect(node);
      node.connect(ctx.destination);
    } catch (e) {
      stopCapture();
      setError(e instanceof Error ? e.message : 'Microphone unavailable');
    }
  }

  function stopCapture(): void {
    try {
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void ctxRef.current?.close();
    } catch { /* ignore */ }
    streamRef.current = null;
    ctxRef.current = null;
    pendingRef.current = [];
  }

  useEffect(() => {
    const v = voice();
    if (!v) return;
    const begin = (): void => {
      if (errorHideRef.current) { clearTimeout(errorHideRef.current); errorHideRef.current = null; }
      setError(null);
      setInterim('');
      setLevel(0);
      setElapsed(0);
      setPhase('recording');
      setActive(true);
      startRef.current = Date.now();
      if (!timerRef.current) timerRef.current = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 250);
      void startCapture();
    };
    void v.getState().then((s) => { if (s === 'recording') begin(); });
    void v.getSettings().then((s) => { setMode(s.mode); setAccelerator(s.accelerator || 'Option+Space'); });
    const offs = [
      v.on('begin', begin),
      v.on('interim', (text) => setInterim(String(text ?? ''))),
      v.on('end', () => {
        setPhase('transcribing');
        const pend = pendingRef.current;
        if (pend.length) { void v.sendChunk(new Float32Array(pend.splice(0, pend.length)), rateRef.current); }
        stopCapture();
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
      }),
      v.on('final', () => { setActive(false); setInterim(''); }),
      v.on('state', (s) => {
        if (s === 'idle') {
          setActive(false);
          stopCapture();
          if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
        }
      }),
      v.on('error', (msg) => {
        setError(String(msg ?? 'Dictation error'));
        setActive(true);
        stopCapture();
        if (errorHideRef.current) clearTimeout(errorHideRef.current);
        errorHideRef.current = setTimeout(() => setActive(false), 2600);
      }),
    ];
    return () => {
      offs.forEach((off) => off?.());
      stopCapture();
      if (timerRef.current) clearInterval(timerRef.current);
      if (errorHideRef.current) clearTimeout(errorHideRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!active) return null;

  const mm = String(Math.floor(elapsed / 60)).padStart(2, '0');
  const ss = String(elapsed % 60).padStart(2, '0');
  const stop = (): void => { void voice()?.toggle(); };
  const hint = mode === 'hold' ? `release ${accelerator} to stop` : `tap ${accelerator} or ■ to stop`;

  return (
    <div className="flex h-screen w-screen items-stretch justify-center bg-transparent p-2 font-mono">
      <div className="flex w-full flex-col gap-1.5 rounded-2xl border border-neutral-800 bg-black/90 px-3 py-2.5 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2.5">
          {error ? (
            <span className="text-xs text-red-400">{error}</span>
          ) : (
            <>
              <span className="relative flex h-2.5 w-2.5 shrink-0">
                {phase === 'recording' && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                )}
                <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${phase === 'recording' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
              </span>
              <Microphone className="h-4 w-4 shrink-0 text-emerald-400" weight="fill" />
              <div className="flex h-4 flex-1 items-center gap-[2px]">
                {Array.from({ length: 22 }).map((_, i) => {
                  const on = level * 22 > i;
                  return (
                    <span
                      key={i}
                      className={`w-[3px] rounded-sm transition-all duration-75 ${on ? 'bg-emerald-400' : 'bg-neutral-700'}`}
                      style={{ height: `${20 + (on ? Math.min(80, (i + 1) * 4) : 8)}%` }}
                    />
                  );
                })}
              </div>
              <span className="shrink-0 text-xs tabular-nums text-neutral-400">
                {phase === 'transcribing' ? 'transcribing…' : `${mm}:${ss}`}
              </span>
              {phase === 'recording' && (
                <button
                  onClick={stop}
                  title="Stop dictation"
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md border border-neutral-700 text-neutral-300 transition-all hover:border-red-600 hover:text-red-400 active:scale-90"
                >
                  <Square className="h-3 w-3" weight="fill" />
                </button>
              )}
            </>
          )}
        </div>
        {!error && (
          interim ? (
            <div
              ref={transcriptRef}
              className="min-h-0 flex-1 overflow-hidden text-[15px] leading-relaxed text-neutral-100"
              style={{ WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 42%)' }}
            >
              <div className="flex min-h-full flex-col justify-end">{interim}</div>
            </div>
          ) : (
            phase === 'recording' && <div className="flex flex-1 items-end text-[11px] text-neutral-600">{hint}</div>
          )
        )}
      </div>
    </div>
  );
}
