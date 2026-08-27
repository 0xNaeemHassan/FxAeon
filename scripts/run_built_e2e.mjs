import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const app = join(root, 'apps', 'mini-app');
const packageManagerCli = process.env.npm_execpath;

const inheritedCli = Boolean(packageManagerCli && existsSync(packageManagerCli));
const command = inheritedCli
  ? process.execPath
  : process.platform === 'win32'
    ? process.env.ComSpec || 'cmd.exe'
    : 'pnpm';
const args = inheritedCli
  ? [packageManagerCli, 'test:e2e']
  : process.platform === 'win32'
    ? ['/d', '/s', '/c', 'pnpm.cmd test:e2e']
    : ['test:e2e'];

const result = spawnSync(command, args, {
  cwd: app,
  stdio: 'inherit',
  windowsHide: true,
  env: {
    ...process.env,
    E2E_BUILD: '0',
    E2E_PORT: process.env.E2E_PORT || '4322',
    E2E_REUSE_SERVER: '0',
  },
});

process.exit(result.status ?? 1);
