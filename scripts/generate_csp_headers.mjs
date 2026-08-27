import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const miniApp = join(root, 'apps', 'mini-app');
const output = join(miniApp, 'dist');
const sourceHeaders = join(miniApp, 'public', '_headers');
const outputHeaders = join(output, '_headers');

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

const hashes = new Set();
const htmlFiles = (await walk(output)).filter((file) => file.endsWith('.html'));
if (htmlFiles.length === 0) throw new Error('CSP generation found no static HTML output');

for (const file of htmlFiles) {
  const html = await readFile(file, 'utf8');
  for (const match of html.matchAll(/<script\b(?![^>]*\bsrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi)) {
    const source = match[1];
    if (!source) continue;
    const digest = createHash('sha256').update(source, 'utf8').digest('base64');
    hashes.add(`'sha256-${digest}'`);
  }
}

if (hashes.size === 0) throw new Error('CSP generation found no inline Next.js bootstrap scripts');

let headers = await readFile(sourceHeaders, 'utf8');
const cspLine = headers.split(/\r?\n/).find((line) => line.includes('Content-Security-Policy:'));
if (!cspLine) throw new Error('public/_headers is missing Content-Security-Policy');
const scriptDirective = cspLine.match(/script-src\s+([^;]+)/)?.[0];
if (!scriptDirective) throw new Error('Content-Security-Policy is missing script-src');
if (scriptDirective.includes("'unsafe-inline'")) {
  throw new Error("script-src must not contain 'unsafe-inline'");
}

const replacement = `${scriptDirective} ${[...hashes].sort().join(' ')}`;
headers = headers.replace(scriptDirective, replacement);
await writeFile(outputHeaders, headers, 'utf8');

console.log(`Generated static CSP with ${hashes.size} reviewed inline-script hashes across ${htmlFiles.length} HTML files.`);
