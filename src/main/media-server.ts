// Tiny loopback HTTP server for local media (meeting recordings, uploads).
//
// Why this exists: serving large seekable video to a <video> element through
// Electron's custom `ogcapture://` protocol + a ReadableStream body proved racy —
// Chromium's media stack cancels range requests aggressively to manage its buffer,
// and the protocol→ReadableStream bridge never recovers (every non-zero-offset
// range delivered 0 bytes and looped). Serving the same file over plain HTTP with
// Node's `fs.createReadStream(...).pipe(res)` is the battle-tested path every video
// on the web uses: real sockets, real Range/206, real cancel/reconnect.
//
// Bound to 127.0.0.1 ONLY (never the LAN), with a per-launch token in the path and
// a strict allowlist of root dirs, so it can't be used to read arbitrary files.

import http from 'http';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { app } from 'electron';
import { parseRange, isPathAllowed } from './media-range';
import { MEDIA_PORT } from '../shared/ports';
import { mimeForExt } from './mime';

// Fixed loopback port so the renderer CSP (media-src) can allowlist it. Bound to
// 127.0.0.1 only — not reachable off-device. Canonical value in shared/ports.

let server: http.Server | null = null;
let token = '';
let port = 0;
let listening = false;
// Canonical (symlink-resolved) allowed roots — comparing canonical-to-canonical is
// what makes the allowlist symlink-proof (a link inside userData pointing elsewhere
// resolves to its real target and fails the check).
let allowedRoots: string[] = [];

/** Resolve symlinks + `..` to a canonical absolute path; null if it can't (e.g. missing). */
function canonical(p: string): string | null {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return null;
  }
}

function serveFile(req: http.IncomingMessage, res: http.ServerResponse, filePath: string): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    res.writeHead(404).end();
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404).end();
    return;
  }
  const size = stat.size;
  const type = mimeForExt(path.extname(filePath));
  const r = parseRange(req.headers.range, size);

  if (r.unsatisfiable) {
    res.writeHead(416, { 'Content-Range': `bytes */${size}` }).end();
    return;
  }
  if (!r.full) {
    res.writeHead(206, {
      'Content-Type': type,
      'Content-Length': r.end - r.start + 1,
      'Content-Range': `bytes ${r.start}-${r.end}/${size}`,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-store',
    });
    const rs = fs.createReadStream(filePath, { start: r.start, end: r.end });
    rs.on('error', () => res.destroy());
    rs.pipe(res);
    return;
  }

  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': size,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store',
  });
  const rs = fs.createReadStream(filePath);
  rs.on('error', () => res.destroy());
  rs.pipe(res);
}

/** Start the loopback media server (idempotent). Call after app is ready. */
export function startMediaServer(): void {
  if (server) return;
  token = randomUUID().replace(/-/g, '');
  // Allowlist ONLY the media sub-dirs, not the whole userData — otherwise the
  // loopback server could serve sensitive app state (memories.db, secrets, license
  // cache, models). Canonicalize each once at startup so symlink-resolved request
  // paths compare correctly (fall back to a plain resolve if the dir doesn't exist).
  const ud = app.getPath('userData');
  allowedRoots = ['meetings', 'uploads', 'captures', 'voice', 'generated-images', 'style-thumbs']
    .map((d) => path.join(ud, d))
    .map((d) => canonical(d) ?? path.resolve(d));

  server = http.createServer((req, res) => {
    const url = req.url || '/';
    // Route: /m/<token>/<base64url(abs path)>
    const prefix = `/m/${token}/`;
    if (!url.startsWith(prefix)) {
      res.writeHead(403).end();
      return;
    }
    let filePath: string;
    try {
      const enc = url.slice(prefix.length).split('?')[0];
      filePath = Buffer.from(decodeURIComponent(enc), 'base64url').toString('utf8');
    } catch {
      res.writeHead(400).end();
      return;
    }
    // Resolve symlinks on the actual file before the allowlist check, so a link
    // inside userData can't smuggle a path outside it past the guard.
    const real = canonical(filePath);
    if (!real || !isPathAllowed(real, allowedRoots)) {
      res.writeHead(real ? 403 : 404).end();
      return;
    }
    serveFile(req, res, real);
  });

  server.on('error', (e) => {
    console.error('[media-server]', e);
    // A listen failure (e.g. EADDRINUSE) must NOT wedge the singleton: reset so a
    // later startMediaServer() can retry instead of being blocked by `if (server)`.
    if (!listening) {
      server = null;
      port = 0;
    }
  });
  // Loopback ONLY — never the LAN. Fixed port so the renderer CSP can allowlist it.
  server.listen(MEDIA_PORT, '127.0.0.1', () => {
    listening = true;
    port = MEDIA_PORT;
    console.log(`[media-server] loopback media at http://127.0.0.1:${port}/m/…`);
  });
}

/** Build a loopback URL the renderer can put in a <video src>. Null until ready. */
export function mediaUrlFor(absPath: string): string | null {
  if (!server || !port || !absPath) return null;
  // Canonicalize so the URL encodes the same real path the server will enforce.
  const real = canonical(absPath);
  if (!real || !isPathAllowed(real, allowedRoots)) return null;
  const enc = Buffer.from(real, 'utf8').toString('base64url');
  return `http://127.0.0.1:${port}/m/${token}/${enc}`;
}

export function stopMediaServer(): void {
  server?.close();
  server = null;
  port = 0;
  listening = false;
}
