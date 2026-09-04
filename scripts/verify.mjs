import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

/**
 * Release verification runner.
 *
 * The checks are independent until the production export exists, so run the
 * static checks together and only serialize the build-dependent gates. This
 * preserves every check in the release contract while avoiding idle time on
 * the Windows CI runner.
 */

const root = process.cwd();
const pnpm = process.env.npm_execpath && existsSync(process.env.npm_execpath)
  ? { command: process.execPath, prefix: [process.env.npm_execpath] }
  : { command: process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', prefix: [] };

function run(command, args, label) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: root,
      stdio: 'inherit',
      windowsHide: true,
      env: process.env,
    });
    child.once('error', (error) => {
      console.error(`[verify] ${label} could not start: ${error.message}`);
      resolve(1);
    });
    child.once('exit', (code, signal) => {
      if (signal) {
        console.error(`[verify] ${label} stopped on ${signal}`);
        resolve(1);
      } else {
        resolve(code ?? 1);
      }
    });
  });
}

function pnpmRun(args, label) {
  return run(pnpm.command, [...pnpm.prefix, ...args], label);
}

async function runGroup(checks, group) {
  const results = await Promise.all(checks.map(({ args, label }) => pnpmRun(args, label)));
  const failed = results.filter((code) => code !== 0);
  if (failed.length) {
    console.error(`[verify] ${group} failed (${failed.length} check${failed.length === 1 ? '' : 's'})`);
    process.exitCode = 1;
    return false;
  }
  return true;
}

const scope = await pnpmRun(['verify:scope'], 'scope verification');
if (scope !== 0) process.exit(scope);

// Lightweight checks can overlap. Run the complete test glob once in a single
// tsx process: it includes the Anvil-contract skips and seeded chaos campaign,
// so every assertion executes without paying for a second compiler startup.
const quickChecks = await runGroup([
  { args: ['lint'], label: 'lint' },
  {
    args: ['audit', '--prod', '--audit-level=high', '--ignore-registry-errors'],
    label: 'dependency audit',
  },
], 'parallel lightweight checks');
const tests = await pnpmRun(['test'], 'unit and chaos tests');
if (!quickChecks || tests !== 0) {
  console.error('[verify] source checks failed');
  process.exit(1);
}

const build = await pnpmRun(['build'], 'production build');
if (build !== 0) process.exit(build);

const builtChecks = await Promise.all([
  pnpmRun(['typecheck'], 'typecheck'),
  pnpmRun(['check:bundle'], 'bundle check'),
  run(process.execPath, ['scripts/run_built_e2e.mjs'], 'built-route E2E'),
]);
const builtFailures = builtChecks.filter((code) => code !== 0);
if (builtFailures.length) {
  console.error(`[verify] build-dependent checks failed (${builtFailures.length})`);
  process.exitCode = 1;
}
