/**
 * Tiny dependency-free static server for the Next.js static export (`dist/`),
 * used as Playwright's `webServer`. It:
 *   - builds the export first if `dist/index.html` is missing (or E2E_BUILD=1),
 *     baking the SAME deterministic env the tests assume;
 *   - serves clean URLs the way Cloudflare Pages does (`/portfolio` → `portfolio.html`);
 *   - serves `_next/**` assets with correct content-types;
 *   - falls back to `404.html` so the app's not-found page renders.
 *
 * The build env is pinned here so the running app's behaviour matches the test
 * fixtures exactly:
 *   NEXT_PUBLIC_BOT_API_URL          = http://localhost:<PORT>  (same-origin → no CORS;
 *                                      Playwright intercepts these requests)
 *   NEXT_PUBLIC_TELEGRAM_BOT_USERNAME= FxAeonBot
 *   NEXT_PUBLIC_PRIVY_APP_ID         = ""  (login shows the deterministic
 *                                      "not configured" gate; no heavy Privy SDK)
 */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4321);

const BUILD_ENV = {
  NEXT_PUBLIC_BOT_API_URL: `http://localhost:${PORT}`,
  NEXT_PUBLIC_TELEGRAM_BOT_USERNAME: 'FxAeonBot',
  NEXT_PUBLIC_PRIVY_APP_ID: '',
};

function buildIfNeeded() {
  if (existsSync(join(DIST, 'index.html')) && process.env.E2E_BUILD !== '1') return;
   
  console.log('[e2e] building mini-app static export…');
  const res = spawnSync('corepack', ['pnpm', 'build'], {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...BUILD_ENV },
  });
  if (res.status !== 0) {
     
    console.error('[e2e] build failed');
    process.exit(res.status ?? 1);
  }
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

async function resolveFile(pathname) {
  // Strip query, normalise, prevent path traversal.
  let p = decodeURIComponent(pathname.split('?')[0]);
  p = normalize(p).replace(/^(\.\.[/\\])+/, '');
  if (p === '/' || p === '') return join(DIST, 'index.html');

  const direct = join(DIST, p);
  // Exact file (assets like /_next/..., /favicon.ico, /file.html).
  try {
    const s = await stat(direct);
    if (s.isFile()) return direct;
    if (s.isDirectory()) {
      const idx = join(direct, 'index.html');
      if (existsSync(idx)) return idx;
    }
  } catch {
    /* not a direct file */
  }
  // Clean URL → <route>.html (how the export emits routes).
  if (!extname(p)) {
    const asHtml = join(DIST, `${p.replace(/\/$/, '')}.html`);
    if (existsSync(asHtml)) return asHtml;
  }
  return null;
}

buildIfNeeded();

const server = createServer(async (req, res) => {
  try {
    const file = await resolveFile(req.url || '/');
    if (!file) {
      const notFound = join(DIST, '404.html');
      const body = existsSync(notFound) ? await readFile(notFound) : Buffer.from('Not found');
      res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
      res.end(body);
      return;
    }
    const body = await readFile(file);
    const type = MIME[extname(file)] || 'application/octet-stream';
    // Immutable hashed assets can cache; HTML must not (deterministic test runs).
    const cache = file.includes(`${'/_next/'}`) && extname(file) !== '.html'
      ? 'public, max-age=31536000, immutable'
      : 'no-store';
    res.writeHead(200, { 'content-type': type, 'cache-control': cache });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`server error: ${err?.message ?? err}`);
  }
});

server.listen(PORT, () => {
   
  console.log(`[e2e] serving ${DIST} at http://localhost:${PORT}`);
});
