export function formatStorageBytes(bytes: number): string {
  if (!bytes) return '0 GB'
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${(bytes / 1e9).toFixed(1)} GB`
}
