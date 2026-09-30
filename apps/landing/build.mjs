import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
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
await cp(resolve(root, '../mini-app/public/brand/fx-official-mark.svg'), resolve(dist, 'assets/fx-protocol.svg'));

// Render the same pinned Lucide components used by the app. The landing ships
// static SVGs, with no React or icon library added to its browser bundle.
const require = createRequire(resolve(root, '../mini-app/package.json'));
const { createElement } = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { ArrowDownToLine, CandlestickChart, ArrowLeftRight, PiggyBank, Layers } = require('lucide-react');
const icons = { receive: ArrowDownToLine, trade: CandlestickChart, move: ArrowLeftRight, earn: PiggyBank, borrow: Layers };
await mkdir(resolve(dist, 'assets/icons'), { recursive: true });
for (const [name, Icon] of Object.entries(icons)) {
  const svg = renderToStaticMarkup(createElement(Icon, { size: 24, color: '#c6a7ff', strokeWidth: 2 }));
  await writeFile(resolve(dist, `assets/icons/${name}.svg`), svg);
}
await cp(resolve(require.resolve('lucide-react/package.json'), '../LICENSE'), resolve(dist, 'assets/icons/LICENSE.txt'));
console.log(`Built ${dist}`);
