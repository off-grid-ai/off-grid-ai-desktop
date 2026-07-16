// Content extraction orchestrator: detect a file's kind from its name, then
// route to the right bridge to produce plain text for chunking/embedding.
//
//   text/code -> readText
//   pdf        -> extractPdf
//   docx       -> extractDocx
//   audio      -> transcribeAudio (transcription model)
//   video      -> sampleVideoFrames + captionImage per frame (vision model)
//   image      -> captionImage (vision model)
//
// Audio and video "just work" off the capabilities we already ship: a
// transcription model for audio, a vision model for video frames / images.

import type { MediaKind } from './types'
import type { ExtractionBridges } from './bridges'

const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma'])
const VIDEO_EXT = new Set(['mp4', 'mov', 'mkv', 'avi', 'webm', 'm4v', 'mpg', 'mpeg'])
const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'tiff', 'heic'])

export function extensionOf(fileName: string): string {
  return (fileName.split('.').pop() ?? '').toLowerCase()
}

/** Classify a file by extension into a MediaKind. */
export function detectKind(fileName: string): MediaKind {
  const ext = extensionOf(fileName)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (AUDIO_EXT.has(ext)) return 'audio'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (IMAGE_EXT.has(ext)) return 'image'
  return 'text'
}

export interface ExtractOptions {
  /** Hard cap on extracted characters (default 500_000). */
  maxChars?: number
  /** Video: sample one frame every N seconds (default 5). */
  videoEverySeconds?: number
  /** Video: cap total sampled frames (default 24). */
  videoMaxFrames?: number
}

export interface ExtractedContent {
  text: string
  kind: MediaKind
}

/** Extract plain text from a file, routing by kind through the given bridges. */
export async function extractContent(
  path: string,
  fileName: string,
  bridges: ExtractionBridges,
  opts: ExtractOptions = {}
): Promise<ExtractedContent> {
  const kind = detectKind(fileName)
  const maxChars = opts.maxChars ?? 500_000
  let text = ''

  switch (kind) {
    case 'pdf':
      if (!bridges.extractPdf) throw new Error('PDF extraction is not available on this platform.')
      text = await bridges.extractPdf(path, maxChars)
      break
    case 'docx':
      if (!bridges.extractDocx)
        throw new Error('DOCX extraction is not available on this platform.')
      text = await bridges.extractDocx(path, maxChars)
      break
    case 'audio':
      if (!bridges.transcribeAudio)
        throw new Error('Audio ingestion needs a transcription model — download one from Models.')
      text = await bridges.transcribeAudio(path)
      break
    case 'video': {
      if (!bridges.sampleVideoFrames || !bridges.captionImage)
        throw new Error('Video ingestion needs a vision model — download one from Models.')
      const frames = await bridges.sampleVideoFrames(path, {
        everySeconds: opts.videoEverySeconds ?? 5,
        maxFrames: opts.videoMaxFrames ?? 24
      })
      const captions: string[] = []
      for (let i = 0; i < frames.length; i++) {
        const c = (await bridges.captionImage(frames[i]))?.trim()
        if (c) captions.push(`[frame ${i + 1}] ${c}`)
      }
      text = captions.join('\n')
      break
    }
    case 'image':
      if (!bridges.captionImage)
        throw new Error('Image ingestion needs a vision model — download one from Models.')
      text = await bridges.captionImage(path)
      break
    default:
      text = await bridges.readText(path)
  }

  if (text.length > maxChars) text = text.slice(0, maxChars)
  return { text, kind }
}
