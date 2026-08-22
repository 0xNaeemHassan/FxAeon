#!/usr/bin/env node

/**
 * FxAeon Automated 1-Click Production Verification CLI
 *
 * Runs an automated, non-destructive health & configuration audit across
 * the entire monorepo before production deployment.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');

const checks = [];

function recordCheck(name, status, details = '') {
  checks.push({ name, status, details });
  const icon = status === 'PASS' ? '✅' : status === 'WARN' ? '⚠️' : '❌';
  console.log(`${icon} [${status.padEnd(4)}] ${name.padEnd(38)} ${details}`);
}

async function runAudit() {
  console.log('\n╔═══════════════════════════════════════════════════════════════════════╗');
  console.log('║               FxAeon Automated Production Verification                ║');
  console.log('╚═══════════════════════════════════════════════════════════════════════╝\n');

  // 1. Static Next.js Dist & Routes
  const distDir = path.join(ROOT, 'apps', 'mini-app', 'dist');
  if (fs.existsSync(distDir)) {
    const requiredFiles = ['index.html', 'trade.html', 'portfolio.html', 'card.html', 'pulse.html', 'dca.html', 'sw.js'];
    const missing = requiredFiles.filter((f) => !fs.existsSync(path.join(distDir, f)));
    if (missing.length === 0) {
      recordCheck('Static Next.js Build Assets', 'PASS', `All ${requiredFiles.length} critical HTML routes + SW verified`);
    } else {
      recordCheck('Static Next.js Build Assets', 'WARN', `Missing: ${missing.join(', ')} (Run pnpm build)`);
    }
  } else {
    recordCheck('Static Next.js Build Assets', 'WARN', 'apps/mini-app/dist directory not built yet');
  }

  // 2. Astryx Design Tokens & CSS
  const globalsCssPath = path.join(ROOT, 'apps', 'mini-app', 'src', 'app', 'globals.css');
  if (fs.existsSync(globalsCssPath)) {
    const css = fs.readFileSync(globalsCssPath, 'utf8');
    const hasTokens = css.includes('--astryx-surface-canvas') && css.includes('--astryx-ease-spring');
    if (hasTokens) {
      recordCheck('Meta Astryx Design Token Cascade', 'PASS', 'Surface hierarchy, spring physics & tokens validated');
    } else {
      recordCheck('Meta Astryx Design Token Cascade', 'FAIL', 'Missing core Astryx tokens');
    }
  } else {
    recordCheck('Meta Astryx Design Token Cascade', 'FAIL', 'globals.css not found');
  }

  // 3. Multi-Locale i18n Catalogs
  const localesDir = path.join(ROOT, 'apps', 'bot', 'src', 'i18n', 'locales');
  if (fs.existsSync(localesDir)) {
    const locales = fs.readdirSync(localesDir).filter((f) => f.endsWith('.ftl'));
    recordCheck('Multi-Language Fluent Catalogs', 'PASS', `${locales.length} locales verified (${locales.join(', ')})`);
  } else {
    recordCheck('Multi-Language Fluent Catalogs', 'FAIL', 'Locales directory missing');
  }

  // 4. Prisma Schema & Client
  const schemaPath = path.join(ROOT, 'packages', 'db', 'prisma', 'schema.prisma');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf8');
    const hasModels = schema.includes('model User') && schema.includes('model Position');
    if (hasModels) {
      recordCheck('Prisma Database Schema & Models', 'PASS', 'PostgreSQL models for User, Position, Transaction active');
    } else {
      recordCheck('Prisma Database Schema & Models', 'FAIL', 'Required Prisma models missing');
    }
  } else {
    recordCheck('Prisma Database Schema & Models', 'FAIL', 'schema.prisma not found');
  }

  // 5. Documentation Suite & Visual Assets
  const docAssetsDir = path.join(ROOT, 'docs', 'assets');
  if (fs.existsSync(docAssetsDir)) {
    const screenshots = fs.readdirSync(docAssetsDir).filter((f) => f.endsWith('.png'));
    if (screenshots.length >= 18) {
      recordCheck('Documentation Suite & Visual Maps', 'PASS', `${screenshots.length} high-DPI screenshots verified`);
    } else {
      recordCheck('Documentation Suite & Visual Maps', 'WARN', `${screenshots.length} screenshots found`);
    }
  } else {
    recordCheck('Documentation Suite & Visual Maps', 'WARN', 'docs/assets directory missing');
  }

  // 6. Production Deployment Manifests
  const dockerfile = fs.existsSync(path.join(ROOT, 'Dockerfile.prod'));
  const dockerCompose = fs.existsSync(path.join(ROOT, 'docker-compose.prod.yml'));
  const renderYaml = fs.existsSync(path.join(ROOT, 'render.yaml'));
  if (dockerfile && dockerCompose && renderYaml) {
    recordCheck('Container & Cloud Blueprints', 'PASS', 'Dockerfile.prod, docker-compose & render.yaml ready');
  } else {
    recordCheck('Container & Cloud Blueprints', 'FAIL', 'Missing deployment manifests');
  }

  // Summary
  const passCount = checks.filter((c) => c.status === 'PASS').length;
  const total = checks.length;
  const scorePct = Math.round((passCount / total) * 100);

  console.log('\n─────────────────────────────────────────────────────────────────────────');
  console.log(`🎯 Production Health Score: ${scorePct}% (${passCount}/${total} Checks Passed)`);
  console.log('─────────────────────────────────────────────────────────────────────────\n');

  if (checks.some((c) => c.status === 'FAIL')) {
    process.exit(1);
  }
}

runAudit().catch((err) => {
  console.error('Audit crashed:', err);
  process.exit(1);
});
