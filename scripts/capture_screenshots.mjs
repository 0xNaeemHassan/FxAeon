import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const EDGE_PATH = '"C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"';
const OUTPUT_DIR = 'C:\\Users\\dexen\\.gemini\\antigravity\\brain\\a5e44531-bb70-4707-9977-086b9de17859\\screenshots';

if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

const PAGES = [
  { name: '01_trade', path: '/trade' },
  { name: '02_portfolio', path: '/portfolio' },
  { name: '03_positions', path: '/positions' },
  { name: '04_radar', path: '/radar' },
  { name: '05_whales', path: '/whales' },
  { name: '06_quests', path: '/quests' },
  { name: '07_leaderboard', path: '/leaderboard' },
  { name: '08_borrow', path: '/borrow' },
  { name: '09_earn', path: '/earn' },
  { name: '10_move', path: '/move' },
  { name: '11_settings', path: '/settings' },
  { name: '12_more', path: '/more' },
  { name: '13_activity', path: '/activity' },
  { name: '14_qr', path: '/qr' },
  { name: '15_landing', path: '/' },
];

async function capture() {
  console.log('Starting screenshot captures...');
  for (const page of PAGES) {
    const outputPath = path.join(OUTPUT_DIR, `${page.name}.png`);
    const url = `http://localhost:3000${page.path}`;
    const cmd = `${EDGE_PATH} --headless --disable-gpu --hide-scrollbars --window-size=412,915 --screenshot="${outputPath}" "${url}"`;
    try {
      console.log(`Capturing ${page.name} (${url})...`);
      execSync(cmd, { stdio: 'ignore', timeout: 15000 });
      console.log(`Saved ${page.name}.png`);
    } catch (err) {
      console.error(`Failed ${page.name}:`, err.message);
    }
  }
  console.log('All screenshots captured successfully!');
}

capture();
