import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

// Deliberately specific patterns: public Privy IDs, public RPC project keys,
// wallet addresses and transaction hashes are not server secrets.
const patterns = [
  ['Privy app secret', /privy_app_secret_[A-Za-z0-9_-]{16,}/],
  ['Telegram bot token', /\b\d{8,12}:[A-Za-z0-9_-]{30,}\b/],
  ['private key block', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['private key literal', /(?:privateKey|PRIVATE_KEY)\s*["']?\s*[:=]\s*["'](?:0x)?[a-fA-F0-9]{64}["']/],
  ['server credential literal', /(?:PRIVY_APP_SECRET|ETHERSCAN_API_KEY|TELEGRAM_BOT_TOKEN)\s*["']?\s*[:=]\s*["'][A-Za-z0-9_-]{16,}["']/],
];

export function secretKinds(source) {
  return patterns.filter(([, pattern]) => pattern.test(source)).map(([kind]) => kind);
}

async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (['node_modules', '.git', 'dist', 'test'].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await files(path));
    else if (/\.(?:[cm]?js|tsx?|html|json|css|svg|txt|xml)$/.test(entry.name)) result.push(path);
  }
  return result;
}

export async function scanFrontend(directories) {
  const findings = [];
  let inspected = 0;
  for (const directory of directories) {
    for (const path of await files(directory)) {
      inspected += 1;
      for (const kind of secretKinds(await readFile(path, 'utf8'))) findings.push({ path, kind });
    }
  }
  return { inspected, findings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(import.meta.dirname, '..');
  const targets = process.argv.includes('--built')
    ? ['apps/mini-app/dist', 'apps/landing/dist']
    : ['apps/mini-app/src', 'apps/mini-app/public', 'apps/landing'];
  const result = await scanFrontend(targets.map((target) => resolve(root, target)));
  for (const finding of result.findings) console.error(`[secrets] ${finding.kind}: ${relative(root, finding.path)}`);
  console.log(`[secrets] ${result.inspected} frontend files checked; ${result.findings.length} credential findings. Values are never printed.`);
  process.exitCode = result.findings.length ? 1 : 0;
}
