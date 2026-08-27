import { promises as fs } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'apps', 'mini-app', 'dist');

// These are deliberately conservative release guardrails, not performance
// claims. They catch an accidental server dependency, source-map upload, or
// eager import of an unrelated SDK without tying CI to a machine-specific
// measurement. Route-level code splitting keeps the trading SDK lazy enough
// for the Telegram WebView.
const MAX_STATIC_BYTES = 12 * 1024 * 1024;
const MAX_JS_BYTES = 8 * 1024 * 1024;
const MAX_JS_GZIP_BYTES = 3 * 1024 * 1024;
const MAX_SINGLE_JS_BYTES = 2 * 1024 * 1024;

async function walk(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    else if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MiB`;
}

try {
  const files = await walk(dist);
  const sourceMaps = files.filter((file) => file.endsWith('.map'));
  const assets = files.filter((file) => !file.endsWith('.map'));
  const javascript = assets.filter((file) => file.endsWith('.js'));
  const assetSizes = await Promise.all(assets.map(async (file) => (await fs.stat(file)).size));
  const staticBytes = assetSizes.reduce((total, bytes) => total + bytes, 0);
  const jsSizes = await Promise.all(javascript.map(async (file) => ({
    file,
    bytes: (await fs.stat(file)).size,
  })));
  const jsBytes = jsSizes.reduce((total, item) => total + item.bytes, 0);
  const gzippedJavaScript = await Promise.all(javascript.map(async (file) => gzipSync(await fs.readFile(file), { level: 9 }).byteLength));
  const jsGzipBytes = gzippedJavaScript.reduce((total, bytes) => total + bytes, 0);
  const largest = [...jsSizes].sort((a, b) => b.bytes - a.bytes)[0];
  const deployedHeaders = await fs.readFile(path.join(dist, '_headers'), 'utf8');
  const deployedScriptDirective = deployedHeaders.match(/script-src\s+([^;]+)/)?.[1] ?? '';

  const failures = [];
  if (sourceMaps.length) failures.push(`source maps must not be published (${sourceMaps.length} found)`);
  if (staticBytes > MAX_STATIC_BYTES) failures.push(`static assets exceed ${formatBytes(MAX_STATIC_BYTES)}`);
  if (jsBytes > MAX_JS_BYTES) failures.push(`JavaScript exceeds ${formatBytes(MAX_JS_BYTES)}`);
  if (jsGzipBytes > MAX_JS_GZIP_BYTES) failures.push(`gzipped JavaScript exceeds ${formatBytes(MAX_JS_GZIP_BYTES)}`);
  if (largest && largest.bytes > MAX_SINGLE_JS_BYTES) {
    failures.push(`single JavaScript asset exceeds ${formatBytes(MAX_SINGLE_JS_BYTES)}: ${path.relative(root, largest.file)}`);
  }
  if (!deployedScriptDirective.includes("'sha256-")) {
    failures.push('deployed script-src is missing generated inline-script hashes');
  }
  if (deployedScriptDirective.includes("'unsafe-inline'")) {
    failures.push("deployed script-src must not allow 'unsafe-inline'");
  }

  console.log(`[bundle] ${assets.length} assets, ${formatBytes(staticBytes)} total`);
  console.log(`[bundle] ${javascript.length} JavaScript assets, ${formatBytes(jsBytes)} raw, ${formatBytes(jsGzipBytes)} gzip`);
  if (largest) console.log(`[bundle] largest JavaScript asset: ${path.relative(root, largest.file)} (${formatBytes(largest.bytes)})`);
  if (failures.length) {
    console.error(`[bundle] FAIL: ${failures.join('; ')}`);
    process.exitCode = 1;
  } else {
    console.log('[bundle] PASS: static bundle is within release budgets');
  }
} catch (error) {
  console.error(`[bundle] unable to inspect ${path.relative(root, dist)}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
