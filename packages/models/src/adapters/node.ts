// Node/Electron DownloadBridge: streams files to the models dir with resume
// (HTTP Range) and progress. Uses global fetch (Node 18+/Electron). RN supplies
// its own bridge (background downloader); this lives at @offgrid/models/node.

import fs from 'fs'
import path from 'path'
import type { DownloadBridge } from '../types'

export class NodeDownloadBridge implements DownloadBridge {
  constructor(private readonly modelsDir: string) {
    fs.mkdirSync(modelsDir, { recursive: true })
  }

  pathFor(fileName: string): string {
    return path.join(this.modelsDir, fileName)
  }

  async exists(destPath: string, expectedBytes?: number): Promise<boolean> {
    try {
      const st = fs.statSync(destPath)
      return expectedBytes ? st.size === expectedBytes : st.size > 0
    } catch {
      return false
    }
  }

  async download(
    url: string,
    destPath: string,
    opts: { onProgress?: (written: number, total: number) => void; signal?: AbortSignal }
  ): Promise<number> {
    const tmp = `${destPath}.part`
    let start = 0
    try {
      start = fs.statSync(tmp).size
    } catch {
      start = 0
    }

    const headers: Record<string, string> = {}
    if (start > 0) headers.Range = `bytes=${start}-`

    const res = await fetch(url, { headers, signal: opts.signal })
    if (!res.ok && res.status !== 206) {
      throw new Error(`download failed: HTTP ${res.status} for ${url}`)
    }
    if (!res.body) throw new Error('download failed: empty body')

    const contentLength = Number(res.headers.get('content-length') ?? 0)
    const total = contentLength + (res.status === 206 ? start : 0)

    const out = fs.createWriteStream(tmp, { flags: start > 0 && res.status === 206 ? 'a' : 'w' })
    let written = res.status === 206 ? start : 0

    const reader = res.body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        out.write(Buffer.from(value))
        written += value.length
        opts.onProgress?.(written, total || written)
      }
    } finally {
      out.end()
      await new Promise<void>((resolve) => out.on('finish', () => resolve()))
    }

    fs.renameSync(tmp, destPath)
    return written
  }
}
