// Quantization metadata + extraction, ported from Off Grid Mobile so desktop
// and mobile share one definition of quant quality/size/recommendation.

export interface QuantInfo {
  bitsPerWeight: number;
  quality: string;
  description: string;
  recommended: boolean;
}

export const QUANTIZATION_INFO: Record<string, QuantInfo> = {
  Q2_K: { bitsPerWeight: 2.625, quality: 'Low', description: 'Extreme compression, noticeable quality loss', recommended: false },
  Q3_K_S: { bitsPerWeight: 3.4375, quality: 'Low-Medium', description: 'High compression, some quality loss', recommended: false },
  Q3_K_M: { bitsPerWeight: 3.4375, quality: 'Medium', description: 'Good compression with acceptable quality', recommended: false },
  Q4_0: { bitsPerWeight: 4, quality: 'Medium', description: 'Basic 4-bit quantization', recommended: false },
  Q4_K_S: { bitsPerWeight: 4.5, quality: 'Medium-Good', description: 'Good balance of size and quality', recommended: true },
  Q4_K_M: { bitsPerWeight: 4.5, quality: 'Good', description: 'Optimal balance - best for most devices', recommended: true },
  Q5_K_S: { bitsPerWeight: 5.5, quality: 'Good-High', description: 'Higher quality, larger size', recommended: false },
  Q5_K_M: { bitsPerWeight: 5.5, quality: 'High', description: 'Near original quality', recommended: false },
  Q6_K: { bitsPerWeight: 6.5, quality: 'Very High', description: 'Minimal quality loss', recommended: false },
  Q8_0: { bitsPerWeight: 8, quality: 'Excellent', description: 'Best quality, largest size', recommended: false },
};

/** Extract a quantization label from a GGUF filename. */
export function extractQuantization(fileName: string): string {
  const upper = fileName.toUpperCase();
  for (const quant of Object.keys(QUANTIZATION_INFO)) {
    if (upper.includes(quant.replace('_', '')) || upper.includes(quant)) return quant;
  }
  const match = fileName.match(/[QqFf]\d+[_]?[KkMmSs]*/);
  return match ? match[0].toUpperCase() : 'Unknown';
}

export function isMMProjFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return lower.includes('mmproj') || lower.includes('projector') || (lower.includes('clip') && lower.endsWith('.gguf'));
}

export function formatFileSize(bytes: number): string {
  if (!bytes) return 'Unknown';
  const units = ['B', 'KB', 'MB', 'GB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}
