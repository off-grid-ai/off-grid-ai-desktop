"use strict";
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

// src/adapters/electron.ts
var electron_exports = {};
__export(electron_exports, {
  ElectronClipboardBridge: () => ElectronClipboardBridge
});
module.exports = __toCommonJS(electron_exports);
var fs = __toESM(require("fs"));
var path = __toESM(require("path"));
var import_child_process = require("child_process");
var MAX_FILE_SIZE = 20 * 1024 * 1024;
var ElectronClipboardBridge = class {
  constructor(clipboard, nativeImage) {
    this.clipboard = clipboard;
    this.nativeImage = nativeImage;
  }
  clipboard;
  nativeImage;
  read() {
    const formats = this.clipboard.availableFormats();
    if (formats.length === 0) return null;
    const extracted = this.extract(formats);
    if (!extracted.rawData || extracted.rawData.length === 0) return null;
    return extracted;
  }
  write(item) {
    switch (item.contentType) {
      case "image": {
        const img = this.nativeImage.createFromBuffer(Buffer.from(item.rawData));
        this.clipboard.writeImage(img);
        return;
      }
      case "rtf": {
        const rtf = Buffer.from(item.rawData).toString("utf-8");
        this.clipboard.writeRTF(rtf);
        if (item.textContent) this.clipboard.writeText(item.textContent);
        return;
      }
      default: {
        const text = item.textContent ?? Buffer.from(item.rawData).toString("utf-8");
        this.clipboard.writeText(text);
      }
    }
  }
  extract(formats) {
    if (formats.some((f) => f.includes("image"))) {
      const image = this.clipboard.readImage();
      if (!image.isEmpty()) {
        return { contentType: "image", rawData: image.toPNG(), textContent: null };
      }
    }
    if (formats.includes("text/rtf")) {
      const rtf = this.clipboard.readRTF();
      const text2 = this.clipboard.readText();
      if (rtf) {
        return { contentType: "rtf", rawData: Buffer.from(rtf, "utf-8"), textContent: text2 || null };
      }
    }
    if (formats.includes("public.file-url") || formats.includes("text/uri-list")) {
      const fileRead = this.extractFile();
      if (fileRead) return fileRead;
    }
    const text = this.clipboard.readText();
    if (text) {
      return { contentType: "text", rawData: Buffer.from(text, "utf-8"), textContent: text };
    }
    return { contentType: "text", rawData: Buffer.from(""), textContent: null };
  }
  extractFile() {
    const macOSFileTypes = [
      "public.file-url",
      "NSFilenamesPboardType",
      "com.apple.nspasteboard.promised-file-url",
      "dyn.ah62d4rv4gu8y",
      "text/uri-list"
    ];
    let fileUrl = null;
    for (const formatType of macOSFileTypes) {
      if (fileUrl) break;
      try {
        const buffer = this.clipboard.readBuffer(formatType);
        if (buffer && buffer.length > 0) {
          let parsed = buffer.toString("utf-8").replace(/\0/g, "").trim();
          if (formatType === "NSFilenamesPboardType" && parsed.includes("<?xml")) {
            const m = parsed.match(/<string>([^<]+)<\/string>/);
            if (m) parsed = m[1];
          }
          if (parsed.includes("\n")) parsed = parsed.split("\n")[0].trim();
          if (parsed && (parsed.startsWith("/") || parsed.startsWith("file://"))) fileUrl = parsed;
        }
      } catch {
      }
    }
    if (!fileUrl) {
      const text = this.clipboard.readText();
      if (text && (text.startsWith("/") || text.startsWith("file://"))) fileUrl = text;
    }
    if (!fileUrl || !(fileUrl.startsWith("/") || fileUrl.startsWith("file://"))) return null;
    const resolved = resolveFileReferenceUrl(fileUrl);
    const filePath = resolved ? resolved : fileUrl.startsWith("file://") ? decodeURIComponent(fileUrl.replace("file://", "")) : fileUrl;
    try {
      const stats = fs.statSync(filePath);
      if (stats.isFile() && stats.size <= MAX_FILE_SIZE) {
        return {
          contentType: "file",
          rawData: fs.readFileSync(filePath),
          textContent: path.basename(filePath)
        };
      }
      if (stats.isFile() && stats.size > MAX_FILE_SIZE) {
        return {
          contentType: "text",
          rawData: Buffer.from(fileUrl, "utf-8"),
          textContent: `[File too large: ${path.basename(filePath)}]`
        };
      }
    } catch {
    }
    return { contentType: "text", rawData: Buffer.from(fileUrl, "utf-8"), textContent: fileUrl };
  }
};
function resolveFileReferenceUrl(fileUrl) {
  if (!fileUrl.includes("/.file/id=")) return null;
  try {
    const script = `
      use framework "Foundation"
      set theURL to current application's NSURL's URLWithString:"${fileUrl}"
      set resolvedURL to theURL's filePathURL()
      if resolvedURL is not missing value then
        return (resolvedURL's |path|()) as text
      else
        return ""
      end if
    `;
    const result = (0, import_child_process.execSync)(`osascript -e '${script.replace(/'/g, `'"'"'`)}'`, {
      encoding: "utf-8",
      timeout: 5e3
    }).trim();
    if (result && result.startsWith("/")) return result;
  } catch {
  }
  return null;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ElectronClipboardBridge
});
