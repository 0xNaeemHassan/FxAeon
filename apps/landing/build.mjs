import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { escapeAttribute, telegramLauncher } from './config.mjs';

const root = resolve(import.meta.dirname);
const telegramUrl = telegramLauncher(process.env.NEXT_PUBLIC_TELEGRAM_APP_URL || undefined);
const dist = resolve(root, 'dist');
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const file of ['index.html', 'styles.css', 'script.js', '404.html', 'robots.txt', 'sitemap.xml', 'document.css']) {
  await cp(resolve(root, file), resolve(dist, file));
  if (file === 'index.html') {
    const html = await readFile(resolve(dist, file), 'utf8');
    await writeFile(resolve(dist, file), html.replaceAll('https://t.me/FxAeonBot', escapeAttribute(telegramUrl)));
  }
}
await cp(resolve(root, '_headers'), resolve(dist, '_headers'));
await cp(resolve(root, 'assets'), resolve(dist, 'assets'), { recursive: true });
console.log(`Built ${dist}`);
