const { existsSync } = require('node:fs');
const { createRequire } = require('node:module');
const { resolve } = require('node:path');

function installedChromePaths(env) {
  if (process.platform === 'win32') {
    return [
      env.PROGRAMFILES && resolve(env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
      env['PROGRAMFILES(X86)'] && resolve(env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
      env.LOCALAPPDATA && resolve(env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') return ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'];
  return ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome'];
}

function localChromeFallback(env) {
  if (env.CI) return undefined;
  const requireFromMiniApp = createRequire(resolve(__dirname, '../apps/mini-app/package.json'));
  const { chromium } = requireFromMiniApp('@playwright/test');
  if (existsSync(chromium.executablePath())) return undefined;
  const executable = installedChromePaths(env).find((candidate) => existsSync(candidate));
  if (!executable) return undefined;
  console.warn(`[playwright] Bundled Chromium is missing; using installed Chrome at ${executable}. Set E2E_BROWSER_CHANNEL explicitly to override.`);
  return 'chrome';
}

/** Resolve the optional Playwright channel. Legacy harness variables win. */
function configuredBrowserChannel(env = process.env, legacyVariable) {
  const legacy = legacyVariable ? env[legacyVariable] : undefined;
  const channel = legacy || env.E2E_BROWSER_CHANNEL;
  if (channel && channel !== 'chrome' && channel !== 'msedge') {
    const source = legacy ? legacyVariable : 'E2E_BROWSER_CHANNEL';
    throw new Error(`${source} must be "chrome" or "msedge".`);
  }
  return channel || localChromeFallback(env);
}

exports.configuredBrowserChannel = configuredBrowserChannel;
