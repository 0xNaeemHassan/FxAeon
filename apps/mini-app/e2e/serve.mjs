/**
 * Tiny dependency-free static server for the Next.js static export (`dist/`),
 * used as Playwright's `webServer`. It:
 *   - builds the export first if `dist/index.html` is missing (or E2E_BUILD=1),
 *     baking the deterministic no-credentials env the tests assume;
 *   - serves clean URLs the way Cloudflare Pages does (`/portfolio` → `portfolio.html`);
 *   - serves `_next/**` assets with correct content-types;
 *   - falls back to `404.html` so the app's not-found page renders.
 *
 * The build env is pinned here so the running app's behaviour matches the
 * no-backend, no-wallet, no-RPC test contract.
 */
import { createServer } from 'node:http';
import { spawnSync } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 4321);

const BUILD_ENV = {
  NEXT_PUBLIC_PRIVY_APP_ID: '',
  NEXT_PUBLIC_ALCHEMY_ETHEREUM_RPC_URL: '',
  NEXT_PUBLIC_ALCHEMY_BASE_RPC_URL: '',
  NEXT_PUBLIC_TELEGRAM_APP_URL: 'https://t.me/FxAeonBot/app',
};

function buildIfNeeded() {
  if (existsSync(join(DIST, 'index.html')) && process.env.E2E_BUILD !== '1') return;
   
  console.log('[e2e] building mini-app static export…');
  // Reuse the package-manager CLI that launched Playwright. This works
  // cross-platform and avoids Windows .cmd shell shims; Corepack remains a
  // direct-exec fallback.
  const packageManagerCli = process.env.npm_execpath;
  const useInheritedPackageManager = packageManagerCli && existsSync(packageManagerCli);
  const windowsFallback = process.platform === 'win32' && !useInheritedPackageManager;
  const command = useInheritedPackageManager
    ? process.execPath
    : windowsFallback
      ? process.env.ComSpec || 'cmd.exe'
      : 'pnpm';
  const isNpmCli = Boolean(packageManagerCli && /npm-cli\.(?:c?js)$/i.test(packageManagerCli));
  const args = useInheritedPackageManager
    ? [packageManagerCli, ...(isNpmCli ? ['run', 'build'] : ['build'])]
    : windowsFallback
      ? ['/d', '/s', '/c', 'pnpm.cmd', 'build']
      : ['build'];
  const res = spawnSync(command, args, {
    cwd: ROOT,
    stdio: 'inherit',
    env: { ...process.env, ...BUILD_ENV },
    windowsHide: true,
  });
  if (res.status !== 0) {
    console.error(`[e2e] build failed${res.error ? `: ${res.error.message}` : ''}`);
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
  p = normalize(p).replace(/^[/\\]+/, '');
  if (p === '/' || p === '') return join(DIST, 'index.html');

  const direct = resolve(DIST, p);
  if (direct !== DIST && !direct.startsWith(`${DIST}${sep}`)) return null;
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
