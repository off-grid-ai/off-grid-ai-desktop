// src/adapters/node.ts
import fs from "fs";
import path from "path";
var NodeDownloadBridge = class {
  constructor(modelsDir) {
    this.modelsDir = modelsDir;
    fs.mkdirSync(modelsDir, { recursive: true });
  }
  modelsDir;
  pathFor(fileName) {
    return path.join(this.modelsDir, fileName);
  }
  async exists(destPath, expectedBytes) {
    try {
      const st = fs.statSync(destPath);
      return expectedBytes ? st.size === expectedBytes : st.size > 0;
    } catch {
      return false;
    }
  }
  async download(url, destPath, opts) {
    var _a;
    const tmp = `${destPath}.part`;
    let start = 0;
    try {
      start = fs.statSync(tmp).size;
    } catch {
      start = 0;
    }
    const headers = {};
    if (start > 0) headers.Range = `bytes=${start}-`;
    const res = await fetch(url, { headers, signal: opts.signal });
    if (!res.ok && res.status !== 206) {
      throw new Error(`download failed: HTTP ${res.status} for ${url}`);
    }
    if (!res.body) throw new Error("download failed: empty body");
    const contentLength = Number(res.headers.get("content-length") ?? 0);
    const total = contentLength + (res.status === 206 ? start : 0);
    const out = fs.createWriteStream(tmp, { flags: start > 0 && res.status === 206 ? "a" : "w" });
    let written = res.status === 206 ? start : 0;
    const reader = res.body.getReader();
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(Buffer.from(value));
        written += value.length;
        (_a = opts.onProgress) == null ? void 0 : _a.call(opts, written, total || written);
      }
    } finally {
      out.end();
      await new Promise((resolve) => out.on("finish", () => resolve()));
    }
    fs.renameSync(tmp, destPath);
    return written;
  }
};
export {
  NodeDownloadBridge
};
