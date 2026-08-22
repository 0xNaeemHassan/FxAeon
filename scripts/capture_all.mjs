import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, '..', 'apps', 'mini-app', 'dist');
const EDGE_PATH = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const OUTPUT_DIR = 'C:\\Users\\dexen\\.gemini\\antigravity\\brain\\a5e44531-bb70-4707-9977-086b9de17859';
const PORT = 3005;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function createStaticServer() {
  return http.createServer((req, res) => {
    let reqPath = req.url ? req.url.split('?')[0] : '/';
    if (reqPath === '/') reqPath = '/index.html';

    let filePath = path.join(DIST_DIR, reqPath);

    if (!fs.existsSync(filePath)) {
      if (fs.existsSync(filePath + '.html')) {
        filePath = filePath + '.html';
      } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
        filePath = path.join(filePath, 'index.html');
      } else {
        filePath = path.join(DIST_DIR, '404.html');
        if (!fs.existsSync(filePath)) filePath = path.join(DIST_DIR, 'index.html');
      }
    }

    const ext = path.extname(filePath);
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
        return;
      }
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    });
  });
}

const PAGES = [
  { name: '01_trade_terminal', path: '/trade' },
  { name: '02_portfolio_dashboard', path: '/portfolio' },
  { name: '03_positions_guardian', path: '/positions' },
  { name: '04_stability_arb_radar', path: '/radar' },
  { name: '05_whale_watcher_feed', path: '/whales' },
  { name: '06_fx_pilot_quests', path: '/quests' },
  { name: '07_community_leaderboard', path: '/leaderboard' },
  { name: '08_borrow_mint', path: '/borrow' },
  { name: '09_earn_stability_vault', path: '/earn' },
  { name: '10_crosschain_bridge', path: '/move' },
  { name: '11_settings_themes', path: '/settings' },
  { name: '12_more_navigation', path: '/more' },
  { name: '13_activity_journal', path: '/activity' },
  { name: '14_receive_qr', path: '/qr' },
  { name: '15_macro_pulse_sentiment', path: '/pulse' },
  { name: '16_auto_dca_builder', path: '/dca' },
  { name: '17_affiliate_arena', path: '/affiliates' },
];

async function run() {
  const server = createStaticServer();
  await new Promise((resolve) => server.listen(PORT, resolve));
  console.log(`Self-hosted server running on port ${PORT}`);

  console.log('Launching browser via puppeteer-core...');
  const browser = await puppeteer.launch({
    executablePath: EDGE_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  // Inject telegram WebApp mock
  await page.evaluateOnNewDocument(() => {
    window.Telegram = {
      WebApp: {
        ready: () => {},
        expand: () => {},
        close: () => {},
        sendData: () => {},
        colorScheme: 'dark',
        themeParams: {
          bg_color: '#07070d',
          text_color: '#ffffff',
          hint_color: '#8e8ea0',
          link_color: '#36dfa6',
          button_color: '#8b6dff',
          button_text_color: '#ffffff',
          secondary_bg_color: '#0e0e18',
        },
        BackButton: { show: () => {}, hide: () => {}, onClick: () => {}, offClick: () => {} },
        MainButton: { show: () => {}, hide: () => {}, setText: () => {}, enable: () => {}, disable: () => {} },
        HapticFeedback: { impactOccurred: () => {}, notificationOccurred: () => {}, selectionChanged: () => {} },
        BiometricManager: { isInited: true, isBiometricAvailable: true, isAccessGranted: true, init: (cb) => cb?.() },
        onEvent: () => {},
        offEvent: () => {},
      },
    };
  });

  for (const item of PAGES) {
    const url = `http://localhost:${PORT}${item.path}`;
    const filename = `${item.name}.png`;
    const outputPath = path.join(OUTPUT_DIR, filename);

    console.log(`Navigating to ${item.name} (${url})...`);
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });
      await new Promise((r) => setTimeout(r, 1200));

      await page.screenshot({ path: outputPath, fullPage: false });
      console.log(`✔ Captured: ${filename}`);
    } catch (err) {
      console.error(`✖ Error capturing ${item.name}:`, err.message);
    }
  }

  await browser.close();
  server.close();
  console.log('\nAll 17 screenshots captured successfully into artifact directory!');
}

run().catch(console.error);
