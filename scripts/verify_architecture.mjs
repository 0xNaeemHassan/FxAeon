import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'apps', 'mini-app', 'src');

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function fail(message) {
  throw new Error(`FxAeon architecture verification failed: ${message}`);
}

const directSdkAllowlist = new Set([
  'apps/mini-app/src/app/trade/fxUi.ts',
  'apps/mini-app/src/components/BridgeTracker.tsx',
  'apps/mini-app/src/lib/confirmedPositions.ts',
]);

for (const file of await walk(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  const name = relative(root, file).replaceAll('\\', '/');
  const isFacade = name.startsWith('apps/mini-app/src/lib/fx/');
  if (source.includes('@aladdindao/fx-sdk')
    && !isFacade && !directSdkAllowlist.has(name)) {
    fail(`direct SDK import must stay behind the fx façade or an audited display adapter: ${name}`);
  }
  if (/from\s+["']@\/lib\/fx\/sdk["']/.test(source) && !isFacade) {
    fail(`SDK singleton import escaped the fx façade: ${name}`);
  }
  // Keep the process-wide SDK singleton private even when a route tries to
  // reach it through the barrel export (`@/lib/fx`). Product code should use
  // the typed read façade or the service boundary instead.
  if (/\b(?:getFxSdk|createFxSdkFacade)\s*\(/.test(source) && !isFacade) {
    fail(`SDK singleton construction escaped the fx façade: ${name}`);
  }
  if (/\bnew\s+(?:Shared)?Worker\s*\(|navigator\.serviceWorker\.register\s*\(|\bimportScripts\s*\(/.test(source)
    && !isFacade) {
    fail(`runtime worker authority is not allowed in the app layer: ${name}`);
  }
}

console.log('FxAeon architecture verified: SDK access is bounded and no app-layer worker authority is active.');
