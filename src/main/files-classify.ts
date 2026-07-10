// Pure upload-classification helpers, extracted from files.ts so they can be
// unit-tested without the electron/fs IO the orchestrator pulls in. Behaviour is
// unchanged — files.ts imports these back and uses them exactly as before.

import path from 'path';

export const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic'];
export const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'flac', 'aiff', 'aif'];
export const VIDEO_EXT = ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'];

export type UploadKind = 'text' | 'pdf' | 'docx' | 'image' | 'audio' | 'video';

/** Route an uploaded file name to its handler kind by extension. Everything that
 *  isn't a known image/audio/video/pdf/docx extension is treated as text. */
export function classifyUpload(name: string): UploadKind {
  const ext = path.extname(name).slice(1).toLowerCase();
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (ext === 'pdf') return 'pdf';
  if (ext === 'docx') return 'docx';
  return 'text';
}

/** Sanitise a file name for use in a temp/persisted path: collapse any run of
 *  characters outside [word chars, dot, dash] to a single underscore. */
export function sanitizeUploadName(name: string): string {
  return name.replace(/[^\w.-]+/g, '_');
}
