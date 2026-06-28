import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';

/**
 * A tiny static server that powers the live preview. delta emits a standalone HTML file, so
 * serving it over localhost (rather than a VS Code webview) lets its inline scripts run natively
 * and sidesteps webview CSP restrictions. The served HTML gets a small SSE client injected so the
 * page reloads itself whenever the compiled file changes on disk.
 *
 * Intentionally free of any `vscode` dependency; the extension layer opens the returned URL in the
 * built-in Simple Browser.
 */

const RELOAD_DEBOUNCE_MS = 120;

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf'
};

interface Entry {
  dir: string;
  fileName: string;
  filePath: string;
  clients: Set<http.ServerResponse>;
  watcher?: fs.FSWatcher;
  reloadTimer?: NodeJS.Timeout;
}

function keyFor(htmlPath: string): string {
  return crypto.createHash('sha1').update(path.resolve(htmlPath)).digest('hex').slice(0, 12);
}

function livereloadSnippet(key: string): string {
  return (
    '\n<script>(function(){try{var es=new EventSource("/__livereload?doc=' +
    key +
    '");es.onmessage=function(){location.reload();};}catch(e){}})();</script>\n'
  );
}

export class PreviewServer {
  private server?: http.Server;
  private heartbeat?: NodeJS.Timeout;
  private port = 0;
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly preferredPort = 0) {}

  /** Register a compiled HTML file for preview and return the URL to open. */
  async preview(htmlPath: string): Promise<string> {
    await this.ensureListening();
    const key = keyFor(htmlPath);
    if (!this.entries.has(key)) {
      this.entries.set(key, this.makeEntry(htmlPath));
    }
    const entry = this.entries.get(key)!;
    return `http://127.0.0.1:${this.port}/${key}/${encodeURIComponent(entry.fileName)}`;
  }

  /** Force-reload any open preview for the given HTML file. */
  reload(htmlPath: string): void {
    const entry = this.entries.get(keyFor(htmlPath));
    if (entry) {
      this.pushReload(entry);
    }
  }

  private makeEntry(htmlPath: string): Entry {
    const resolved = path.resolve(htmlPath);
    const dir = path.dirname(resolved);
    const fileName = path.basename(resolved);
    const entry: Entry = { dir, fileName, filePath: resolved, clients: new Set() };
    try {
      // Watch the directory (more robust than watching a single file across atomic rewrites)
      // and filter to our output file.
      entry.watcher = fs.watch(dir, (_event, changed) => {
        if (!changed || path.basename(changed) === fileName) {
          this.pushReload(entry);
        }
      });
    } catch {
      // Directory may not exist yet; the watcher is best-effort.
    }
    return entry;
  }

  private pushReload(entry: Entry): void {
    if (entry.reloadTimer) {
      clearTimeout(entry.reloadTimer);
    }
    entry.reloadTimer = setTimeout(() => {
      for (const res of entry.clients) {
        res.write('data: reload\n\n');
      }
    }, RELOAD_DEBOUNCE_MS);
  }

  private ensureListening(): Promise<void> {
    if (this.server) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.on('error', reject);
      server.listen(this.preferredPort, '127.0.0.1', () => {
        this.port = (server.address() as AddressInfo).port;
        this.server = server;
        this.heartbeat = setInterval(() => {
          for (const entry of this.entries.values()) {
            for (const res of entry.clients) {
              res.write(': ping\n\n');
            }
          }
        }, 30000);
        resolve();
      });
    });
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/__livereload') {
      this.handleSse(url, res);
      return;
    }

    // Routes are /<key>/<relative-path>.
    const match = /^\/([0-9a-f]{12})\/(.*)$/.exec(pathname);
    if (!match) {
      res.writeHead(404).end('Not found');
      return;
    }
    const entry = this.entries.get(match[1]);
    if (!entry) {
      res.writeHead(404).end('Unknown document');
      return;
    }

    const requested = match[2] || entry.fileName;
    const target = path.resolve(entry.dir, requested);
    // Prevent path traversal outside the document directory.
    if (target !== entry.dir && !target.startsWith(entry.dir + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    this.serveFile(target, entry, res);
  }

  private handleSse(url: URL, res: http.ServerResponse): void {
    const key = url.searchParams.get('doc') ?? '';
    const entry = this.entries.get(key);
    if (!entry) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('retry: 1000\n\n');
    entry.clients.add(res);
    res.on('close', () => entry.clients.delete(res));
  }

  private serveFile(target: string, entry: Entry, res: http.ServerResponse): void {
    fs.readFile(target, (err, data) => {
      if (err) {
        if (target === entry.filePath) {
          // The output isn't built yet: serve a self-reloading placeholder so the page
          // refreshes automatically once delta finishes the first compile.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildingPlaceholder(keyFor(entry.filePath)));
        } else {
          res.writeHead(404).end('Not found');
        }
        return;
      }
      const ext = path.extname(target).toLowerCase();
      const mime = MIME[ext] ?? 'application/octet-stream';
      if (target === entry.filePath) {
        const html = injectLivereload(data.toString('utf8'), keyFor(entry.filePath));
        res.writeHead(200, { 'Content-Type': mime });
        res.end(html);
      } else {
        res.writeHead(200, { 'Content-Type': mime });
        res.end(data);
      }
    });
  }

  dispose(): void {
    if (this.heartbeat) {
      clearInterval(this.heartbeat);
    }
    for (const entry of this.entries.values()) {
      entry.watcher?.close();
      if (entry.reloadTimer) {
        clearTimeout(entry.reloadTimer);
      }
      for (const res of entry.clients) {
        res.end();
      }
    }
    this.entries.clear();
    this.server?.close();
    this.server = undefined;
  }
}

/** Minimal page shown until the first compile lands; reloads itself when it does. */
function buildingPlaceholder(key: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Delta preview</title>' +
    '<style>body{font-family:sans-serif;color:#888;display:grid;place-items:center;height:100vh;margin:0}</style>' +
    '</head><body><p>Building…</p>' +
    livereloadSnippet(key) +
    '</body></html>'
  );
}

/** Insert the livereload client before the closing </body> (or append if absent). */
export function injectLivereload(html: string, key: string): string {
  const snippet = livereloadSnippet(key);
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) {
    return html + snippet;
  }
  return html.slice(0, idx) + snippet + html.slice(idx);
}
