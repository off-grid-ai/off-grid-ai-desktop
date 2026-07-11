"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  ClipboardEngine: () => ClipboardEngine,
  fuzzyMatch: () => fuzzyMatch,
  fuzzySearch: () => fuzzySearch
});
module.exports = __toCommonJS(index_exports);

// src/engine.ts
var ClipboardEngine = class {
  opts;
  handle = null;
  lastHash = "";
  listeners = [];
  constructor(options) {
    this.opts = {
      pollIntervalMs: 500,
      ...options
    };
  }
  /** Subscribe to new clipboard items. Returns an unsubscribe function. */
  onItem(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== listener);
    };
  }
  start() {
    if (this.handle != null) return;
    const current = this.safeRead();
    this.lastHash = current ? this.opts.hash(current.rawData) : "";
    const schedule = this.opts.setInterval ?? ((cb, ms) => setInterval(cb, ms));
    this.handle = schedule(() => this.tick(), this.opts.pollIntervalMs);
  }
  stop() {
    if (this.handle == null) return;
    const clear = this.opts.clearInterval ?? ((h) => clearInterval(h));
    clear(this.handle);
    this.handle = null;
  }
  /** Read the clipboard once and persist if it is new. Exposed for tests. */
  tick() {
    const read = this.safeRead();
    if (!read || read.rawData.length === 0) return null;
    const hash = this.opts.hash(read.rawData);
    if (hash === this.lastHash) return null;
    const inserted = this.opts.store.insert({
      timestamp: Date.now(),
      contentType: read.contentType,
      textContent: read.textContent,
      rawData: read.rawData,
      sourceApp: read.sourceApp ?? null,
      hash
    });
    this.lastHash = hash;
    if (inserted) {
      for (const l of this.listeners) {
        try {
          l(inserted);
        } catch (e) {
          console.error("[clipboard] onItem listener threw", e);
        }
      }
    }
    return inserted;
  }
  safeRead() {
    try {
      return this.opts.bridge.read();
    } catch {
      return null;
    }
  }
};

// src/fuzzy-search.ts
function fuzzyMatch(pattern, text) {
  if (!pattern || !text) {
    return null;
  }
  const patternLower = pattern.toLowerCase();
  const textLower = text.toLowerCase();
  let patternIndex = 0;
  for (let i = 0; i < textLower.length && patternIndex < patternLower.length; i++) {
    if (textLower[i] === patternLower[patternIndex]) {
      patternIndex++;
    }
  }
  if (patternIndex !== patternLower.length) {
    return null;
  }
  const result = findBestMatch(patternLower, textLower);
  if (!result) {
    return null;
  }
  return result;
}
function findBestMatch(pattern, text) {
  const matches = [];
  let score = 0;
  let patternIdx = 0;
  let consecutiveBonus = 0;
  for (let textIdx = 0; textIdx < text.length && patternIdx < pattern.length; textIdx++) {
    if (text[textIdx] === pattern[patternIdx]) {
      matches.push(textIdx);
      let matchScore = 1;
      if (matches.length > 1 && matches[matches.length - 1] === matches[matches.length - 2] + 1) {
        consecutiveBonus++;
        matchScore += consecutiveBonus * 2;
      } else {
        consecutiveBonus = 0;
      }
      if (textIdx === 0 || isWordBoundary(text[textIdx - 1])) {
        matchScore += 5;
      }
      if (textIdx > 0 && isUpperCase(text[textIdx]) && isLowerCase(text[textIdx - 1])) {
        matchScore += 3;
      }
      if (textIdx === 0) {
        matchScore += 10;
      }
      score += matchScore;
      patternIdx++;
    }
  }
  if (patternIdx !== pattern.length) {
    return null;
  }
  const unmatchedPenalty = (text.length - matches.length) * 0.1;
  score = Math.max(0, score - unmatchedPenalty);
  score = score / pattern.length;
  const ranges = indicesToRanges(matches);
  return { score, matches: ranges };
}
function isWordBoundary(char) {
  return /[\s\-_.,;:!?()[\]{}'"\/\\]/.test(char);
}
function isUpperCase(char) {
  return char >= "A" && char <= "Z";
}
function isLowerCase(char) {
  return char >= "a" && char <= "z";
}
function indicesToRanges(indices) {
  if (indices.length === 0) {
    return [];
  }
  const ranges = [];
  let start = indices[0];
  let end = indices[0];
  for (let i = 1; i < indices.length; i++) {
    if (indices[i] === end + 1) {
      end = indices[i];
    } else {
      ranges.push([start, end + 1]);
      start = indices[i];
      end = indices[i];
    }
  }
  ranges.push([start, end + 1]);
  return ranges;
}
function wordMatchBonus(query, text) {
  const queryWords = query.toLowerCase().split(/\s+/).filter((w) => w.length > 0);
  if (queryWords.length === 0) return 0;
  const textLower = text.toLowerCase();
  let bonus = 0;
  for (const word of queryWords) {
    const wordRegex = new RegExp(`(?:^|[\\s\\-_.,;:!?()\\[\\]{}'"\\/\\\\])${escapeRegex(word)}(?:$|[\\s\\-_.,;:!?()\\[\\]{}'"\\/\\\\])`, "i");
    if (wordRegex.test(text)) {
      bonus += 50;
    } else if (textLower.includes(word)) {
      bonus += 30;
    }
  }
  const allWordsFound = queryWords.every((word) => textLower.includes(word));
  if (allWordsFound) {
    bonus += 20;
  }
  return bonus;
}
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function fuzzySearch(items, query) {
  const results = [];
  for (const item of items) {
    const text = item.textContent || item.preview;
    const matchResult = fuzzyMatch(query, text);
    if (matchResult) {
      const bonus = wordMatchBonus(query, text);
      results.push({
        item,
        score: matchResult.score + bonus,
        matches: matchResult.matches
      });
    }
  }
  results.sort((a, b) => b.score - a.score || b.item.timestamp - a.item.timestamp);
  return results.slice(0, 100);
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  ClipboardEngine,
  fuzzyMatch,
  fuzzySearch
});
