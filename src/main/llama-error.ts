// Turn llama-server's stderr into a human, actionable reason when it dies on
// load. Kept pure + Electron-free so it's unit-testable (see __tests__). The app
// otherwise shows a blank "Model installed but server is not running", which has
// led to real users (and us) guessing at code-signing when the truth was in the
// stderr the whole time — e.g. "unknown model architecture: 'gemma4'".

import { deviceNoun, type DevicePlatform } from '../shared/device'

export interface LlamaFailure {
  /** Stable code for UI/branching. */
  code:
    | 'engine_outdated'
    | 'os_too_old'
    | 'out_of_memory'
    | 'missing_library'
    | 'model_corrupt'
    | 'unknown'
  /** One-line, user-facing explanation + what to do. */
  reason: string
}

/**
 * Classify the most recent llama-server stderr. Returns null if nothing in the
 * text looks like a known fatal cause (so callers can fall back to a generic
 * message). Order matters: most specific first.
 */
export function classifyLlamaError(
  stderr: string,
  platform: DevicePlatform = process.platform
): LlamaFailure | null {
  const s = (stderr || '').toLowerCase()
  if (!s.trim()) return null

  // The model's architecture is newer than the bundled engine understands.
  // e.g. "error loading model architecture: unknown model architecture: 'gemma4'"
  if (/unknown model architecture|unsupported model architecture|unknown architecture/.test(s)) {
    const arch = stderr.match(/architecture:?\s*'([^']+)'/i)?.[1]
    return {
      code: 'engine_outdated',
      reason: arch
        ? `The model engine is too old for this model (${arch}). Update Off Grid AI, or switch to a supported model in Models.`
        : `The model engine is too old for this model. Update Off Grid AI, or switch to a supported model in Models.`
    }
  }

  // The native binary requires a newer macOS than the user is running (dyld).
  if (
    /newer than the running os|built for (mac\s?os|ios).*newer|minimum.*os.*version|dyld.*newer/.test(
      s
    )
  ) {
    return {
      code: 'os_too_old',
      reason: 'The model engine needs a newer version of macOS than this Mac is running.'
    }
  }

  // Memory pressure on load (Metal/host alloc, OOM kill).
  if (
    /failed to allocate|out of memory|insufficient memory|cannot allocate|ggml_metal.*alloc|unable to allocate|vk_error_out_of_device_memory|oom/.test(
      s
    )
  ) {
    return {
      code: 'out_of_memory',
      reason: `Out of memory - this model is too large for this ${deviceNoun(platform)}. Try a smaller model or Conservative mode.`
    }
  }

  // A required dylib is missing or unloadable.
  if (
    /library not loaded|image not found|dyld: .*not found|no such file.*\.dylib|symbol not found/.test(
      s
    )
  ) {
    return {
      code: 'missing_library',
      reason: 'A required engine library is missing or could not be loaded.'
    }
  }

  // Corrupt / truncated weights.
  if (
    /failed to load model|invalid magic|tensor.*not found|gguf.*(invalid|corrupt|truncat)|done_getting_tensors.*wrong/.test(
      s
    )
  ) {
    return {
      code: 'model_corrupt',
      reason: 'The model file looks corrupt or incomplete. Re-download it from Models.'
    }
  }

  return null
}
