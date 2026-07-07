var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/adapters/node.ts
var node_exports = {};
__export(node_exports, {
  NodeDownloadBridge: () => NodeDownloadBridge
});
module.exports = __toCommonJS(node_exports);
var import_fs = __toESM(require("fs"));
var import_path = __toESM(require("path"));
var NodeDownloadBridge = class {
  constructor(modelsDir) {
    this.modelsDir = modelsDir;
    import_fs.default.mkdirSync(modelsDir, { recursive: true });
  }
  pathFor(fileName) {
    return import_path.default.join(this.modelsDir, fileName);
  }
  async exists(destPath, expectedBytes) {
    try {
      const st = import_fs.default.statSync(destPath);
      return expectedBytes ? st.size === expectedBytes : st.size > 0;
    } catch {
      return false;
    }
  }
  async download(url, destPath, opts) {
    const tmp = `${destPath}.part`;
    let start = 0;
    try {
      start = import_fs.default.statSync(tmp).size;
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
    const out = import_fs.default.createWriteStream(tmp, { flags: start > 0 && res.status === 206 ? "a" : "w" });
    let written = res.status === 206 ? start : 0;
    const reader = res.body.getReader();
    try {
      for (; ; ) {
        const { done, value } = await reader.read();
        if (done) break;
        out.write(Buffer.from(value));
        written += value.length;
        opts.onProgress?.(written, total || written);
      }
    } finally {
      out.end();
      await new Promise((resolve) => out.on("finish", () => resolve()));
    }
    import_fs.default.renameSync(tmp, destPath);
    return written;
  }
};
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  NodeDownloadBridge
});
