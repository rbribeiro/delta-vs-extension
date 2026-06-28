import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { AddressInfo } from 'net';

/**
 * A tiny static server that powers the live preview. delta emits a standalone HTML file, so
 * serving it over localhost (rather than a VS Code webview) lets its inline scripts run natively
 * and sidesteps webview CSP restrictions. Every HTML page it serves gets a small SSE client
 * injected so the page reloads itself whenever its compiled file changes on disk.
 *
 * The server is **directory-oriented**: one entry per output directory, serving every file in it.
 * This matters for projects — clicking a cross-document link (ch1.html → ch2.html) navigates to a
 * sibling file in the same dir, and that page must also live-reload when its own source rebuilds.
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
  /** SSE clients grouped by the file (basename) each one is currently viewing. */
  clients: Map<string, Set<http.ServerResponse>>;
  watcher?: fs.FSWatcher;
  reloadTimers: Map<string, NodeJS.Timeout>;
}

/** Route key for a served directory. */
function keyForDir(dir: string): string {
  return crypto.createHash('sha1').update(path.resolve(dir)).digest('hex').slice(0, 12);
}

/**
 * The injected live-reload client. It:
 *  - subscribes to SSE for this page's file,
 *  - on `reload`, reloads in place but **preserves scroll position** (so delta's on-load
 *    `location.hash` scroll can't yank the page back to a previously-clicked reference),
 *  - on `navigate:<file>`, switches to a sibling document (used when you save a different
 *    chapter than the one currently shown) — landing without a hash so delta doesn't jump.
 */
function livereloadSnippet(dirKey: string, fileName: string): string {
  const KEY = JSON.stringify(dirKey);
  const FILE = JSON.stringify(fileName);
  return (
    '\n<script>(function(){' +
    'var KEY=' +
    KEY +
    ',FILE=' +
    FILE +
    ';' +
    'var SKEY="__delta_scroll__"+location.pathname;' +
    // Restore scroll after delta's load-time hash scroll, if this load followed a reload.
    'try{var s=sessionStorage.getItem(SKEY);if(s!==null){sessionStorage.removeItem(SKEY);' +
    'var y=parseInt(s,10)||0;var r=function(){window.scrollTo(0,y);};' +
    'window.addEventListener("load",function(){r();requestAnimationFrame(r);});}}catch(e){}' +
    'var t=null;' +
    'function reloadSoon(){if(t)clearTimeout(t);t=setTimeout(function(){' +
    'try{sessionStorage.setItem(SKEY,String(window.scrollY));}catch(e){}location.reload();},150);}' +
    'function dir(){return location.pathname.slice(0,location.pathname.lastIndexOf("/")+1);}' +
    'try{var es=new EventSource("/__livereload?doc="+KEY+"&file="+encodeURIComponent(FILE));' +
    'es.onmessage=function(ev){var d=ev.data||"";' +
    'if(d.indexOf("navigate:")===0){var to=d.slice(9);' +
    'if(to!==FILE){if(t)clearTimeout(t);location.href=dir()+encodeURIComponent(to);}return;}' +
    'reloadSoon();};}catch(e){}' +
    '})();</script>\n'
  );
}

export class PreviewServer {
  private server?: http.Server;
  private heartbeat?: NodeJS.Timeout;
  private port = 0;
  /** key = directory hash. */
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly preferredPort = 0) {}

  /** Register a compiled HTML file for preview and return the URL to open. */
  async preview(htmlPath: string): Promise<string> {
    await this.ensureListening();
    const resolved = path.resolve(htmlPath);
    const dir = path.dirname(resolved);
    const key = keyForDir(dir);
    if (!this.entries.has(key)) {
      this.entries.set(key, this.makeEntry(dir));
    }
    return `http://127.0.0.1:${this.port}/${key}/${encodeURIComponent(path.basename(resolved))}`;
  }

  /** Force-reload any open preview of the given HTML file. */
  reload(htmlPath: string): void {
    const resolved = path.resolve(htmlPath);
    const entry = this.entries.get(keyForDir(path.dirname(resolved)));
    if (entry) {
      this.scheduleReload(entry, path.basename(resolved));
    }
  }

  /**
   * Ask any open preview of this document's directory to switch to the given page. Pages already
   * showing it ignore the request; pages showing a sibling navigate to it. Used to make the
   * preview follow the document the user is editing.
   */
  navigate(htmlPath: string): void {
    const resolved = path.resolve(htmlPath);
    const entry = this.entries.get(keyForDir(path.dirname(resolved)));
    if (!entry) {
      return;
    }
    const message = `data: navigate:${path.basename(resolved)}\n\n`;
    for (const clients of entry.clients.values()) {
      for (const res of clients) {
        res.write(message);
      }
    }
  }

  private makeEntry(dir: string): Entry {
    const entry: Entry = { dir, clients: new Map(), reloadTimers: new Map() };
    try {
      // Watch the directory and reload whichever page corresponds to the changed file. This
      // covers every .html delta emits into the dir (e.g. each chapter of a project), not just
      // the one initially previewed.
      entry.watcher = fs.watch(dir, (_event, changed) => {
        if (changed) {
          this.scheduleReload(entry, path.basename(changed.toString()));
        }
      });
    } catch {
      // Directory may not exist yet; the watcher is best-effort.
    }
    return entry;
  }

  private scheduleReload(entry: Entry, fileName: string): void {
    const existing = entry.reloadTimers.get(fileName);
    if (existing) {
      clearTimeout(existing);
    }
    entry.reloadTimers.set(
      fileName,
      setTimeout(() => {
        entry.reloadTimers.delete(fileName);
        const clients = entry.clients.get(fileName);
        if (clients) {
          for (const res of clients) {
            res.write('data: reload\n\n');
          }
        }
      }, RELOAD_DEBOUNCE_MS)
    );
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
        this.heartbeat = setInterval(() => this.ping(), 30000);
        resolve();
      });
    });
  }

  private ping(): void {
    for (const entry of this.entries.values()) {
      for (const clients of entry.clients.values()) {
        for (const res of clients) {
          res.write(': ping\n\n');
        }
      }
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);

    if (pathname === '/__livereload') {
      this.handleSse(url, res);
      return;
    }

    // Routes are /<dirKey>/<relative-path>.
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

    const requested = match[2] || 'index.html';
    const target = path.resolve(entry.dir, requested);
    // Prevent path traversal outside the served directory.
    if (target !== entry.dir && !target.startsWith(entry.dir + path.sep)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    this.serveFile(target, match[1], res);
  }

  private handleSse(url: URL, res: http.ServerResponse): void {
    const key = url.searchParams.get('doc') ?? '';
    const file = url.searchParams.get('file') ?? '';
    const entry = this.entries.get(key);
    if (!entry || !file) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });
    res.write('retry: 1000\n\n');

    let clients = entry.clients.get(file);
    if (!clients) {
      clients = new Set();
      entry.clients.set(file, clients);
    }
    clients.add(res);
    res.on('close', () => clients!.delete(res));
  }

  private serveFile(target: string, dirKey: string, res: http.ServerResponse): void {
    const ext = path.extname(target).toLowerCase();
    const isHtml = ext === '.html';
    const fileName = path.basename(target);

    fs.readFile(target, (err, data) => {
      if (err) {
        if (isHtml) {
          // Not built yet (or a cross-link to a page about to be compiled): serve a self-reloading
          // placeholder so it refreshes automatically once delta writes the file.
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(buildingPlaceholder(dirKey, fileName));
        } else {
          res.writeHead(404).end('Not found');
        }
        return;
      }
      const mime = MIME[ext] ?? 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': mime });
      if (isHtml) {
        res.end(injectLivereload(data.toString('utf8'), dirKey, fileName));
      } else {
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
      for (const timer of entry.reloadTimers.values()) {
        clearTimeout(timer);
      }
      for (const clients of entry.clients.values()) {
        for (const res of clients) {
          res.end();
        }
      }
    }
    this.entries.clear();
    this.server?.close();
    this.server = undefined;
  }
}

/** Minimal page shown until a file is built; reloads itself when it lands. */
function buildingPlaceholder(dirKey: string, fileName: string): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8"><title>Delta preview</title>' +
    '<style>body{font-family:sans-serif;color:#888;display:grid;place-items:center;height:100vh;margin:0}</style>' +
    '</head><body><p>Building…</p>' +
    livereloadSnippet(dirKey, fileName) +
    '</body></html>'
  );
}

/** Insert the livereload client before the closing </body> (or append if absent). */
export function injectLivereload(html: string, dirKey: string, fileName: string): string {
  const snippet = livereloadSnippet(dirKey, fileName);
  const idx = html.toLowerCase().lastIndexOf('</body>');
  if (idx === -1) {
    return html + snippet;
  }
  return html.slice(0, idx) + snippet + html.slice(idx);
}
