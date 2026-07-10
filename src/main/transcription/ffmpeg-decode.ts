// Single source of truth for the "decode any audio/video to 16 kHz mono PCM WAV"
// ffmpeg invocation. The exact argv + the decode timeout were copy-pasted into
// whisper-cli, whisper-server, and parakeet-cli — a change to the sample rate,
// channel count, or timeout had to be made in three places, in sync. The pure
// pieces (argv + timeout) live here and are unit-tested; each caller keeps its
// own ffmpeg-binary resolution + tmp-file lifecycle.

/** Cap the decode so a malformed/streaming input can't hang the process forever. */
export const DECODE_TIMEOUT_MS = 10 * 60_000;

/**
 * ffmpeg args to re-encode `inputPath` into a 16 kHz mono PCM WAV at `outPath`:
 * `-y` overwrite, `-vn` drop any video track (so A/V files decode too), 16 kHz
 * mono, `-f wav` force the container. The 16 kHz mono contract is what whisper /
 * parakeet expect on input.
 */
export function decodeToWavArgs(inputPath: string, outPath: string): string[] {
  return ['-y', '-i', inputPath, '-vn', '-ar', '16000', '-ac', '1', '-f', 'wav', outPath];
}
