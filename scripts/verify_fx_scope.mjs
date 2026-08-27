import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const mini = join(root, 'apps', 'mini-app');
const scopeLock = JSON.parse(await readFile(join(root, 'fx-scope.lock.json'), 'utf8'));

const expectedMethods = [
  'getPositions',
  'increasePosition',
  'reducePosition',
  'adjustPositionLeverage',
  'depositAndMint',
  'repayAndWithdraw',
  'getBridgeQuote',
  'buildBridgeTx',
  'getFxSaveBalance',
  'getFxSaveConfig',
  'getFxSaveRedeemStatus',
  'getFxSaveClaimable',
  'getRedeemTx',
  'depositFxSave',
  'withdrawFxSave',
].sort();

if (JSON.stringify([...scopeLock.methods].sort()) !== JSON.stringify(expectedMethods)) {
  fail('fx-scope.lock.json does not contain the exact official method contract');
}

const allowedRoutes = new Set([
  '',
  'borrow',
  'earn',
  'login',
  'more',
  'move',
  'portfolio',
  'positions',
  'qr',
  'settings',
  'trade',
]);

const forbiddenSourcePatterns = [
  ['legacy backend client', /@\/lib\/api|\/api\/v1\/miniapp|NEXT_PUBLIC_BOT_API_URL/],
  ['server Privy authority', /@privy-io\/server-auth|PRIVY_AUTHORIZATION_KEY|PRIVY_APP_SECRET/],
  ['delegated signing', /grantAuthorization|walletDelegated|PRIVY_SIGNER_ID|NEXT_PUBLIC_PRIVY_SIGNER_ID/],
  ['removed shared protocol layer', /@fxaeon\/shared/],
];

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else files.push(path);
  }
  return files;
}

function fail(message) {
  throw new Error(`FxAeon scope verification failed: ${message}`);
}

const packageJson = JSON.parse(await readFile(join(mini, 'package.json'), 'utf8'));
if (packageJson.dependencies?.['@aladdindao/fx-sdk'] !== '1.0.5') {
  fail('@aladdindao/fx-sdk must remain exactly pinned to 1.0.5');
}
for (const [name, version] of Object.entries({
  ...(packageJson.dependencies ?? {}),
  ...(packageJson.devDependencies ?? {}),
})) {
  if (typeof version !== 'string' || /^[~^*]|\bx\b|latest/i.test(version)) {
    fail(`dependency ${name} must use an exact reviewed version`);
  }
}

const declarationPath = join(mini, 'node_modules', '@aladdindao', 'fx-sdk', 'dist', 'index.d.ts');
const declaration = await readFile(declarationPath, 'utf8');
const sdkRuntime = await readFile(
  join(mini, 'node_modules', '@aladdindao', 'fx-sdk', 'dist', 'index.js'),
  'utf8',
);
if (/console\.log\("(?:err------|poolData-->|poolInfo-->)"/.test(sdkRuntime)) {
  fail('the installed SDK still contains audited-out production diagnostic logs');
}
const classStart = declaration.indexOf('declare class FxSdk');
const classEnd = declaration.indexOf('\n}\n\ndeclare const tokens', classStart);
if (classStart < 0 || classEnd < 0) fail('could not inspect the installed FxSdk class');
const methods = [...declaration.slice(classStart, classEnd).matchAll(/^\s{4}([A-Za-z]\w*)\(/gm)]
  .map((match) => match[1])
  .filter((method) => method !== 'constructor')
  .sort();
if (JSON.stringify(methods) !== JSON.stringify(expectedMethods)) {
  fail(`SDK method surface changed. Expected ${expectedMethods.join(', ')}; received ${methods.join(', ')}`);
}

const patch = await readFile(join(root, 'patches', '@aladdindao__fx-sdk.patch'), 'utf8');
for (const required of [
  'rawCollateral: this.config.isShort ? 0n : poolInfoRes[2]',
  'debtCapacity: this.config.isShort ? poolInfoRes[2] : poolInfoRes[3]',
  'debtBalance: this.config.isShort ? poolInfoRes[3] : poolInfoRes[4]',
]) {
  if (!patch.includes(required)) fail('the audited upstream short-pool fix is missing');
}

const staticHeaders = await readFile(join(mini, 'public', '_headers'), 'utf8');
const scriptDirective = staticHeaders.match(/script-src\s+([^;]+)/)?.[1];
if (!scriptDirective || scriptDirective.includes("'unsafe-inline'")) {
  fail("the production script-src policy must be hash-based and cannot allow 'unsafe-inline'");
}
const connectSources = staticHeaders.match(/connect-src\s+([^;]+)/)?.[1].split(/\s+/) ?? [];
if (connectSources.includes('https:') || connectSources.includes('wss:')) {
  fail('connect-src contains a broad scheme source instead of reviewed hosts');
}
for (const removedLog of ['console.log("err------"', 'console.log("poolData-->"', 'console.log("poolInfo-->"']) {
  if (!patch.includes(`-${'      '}${removedLog}`) && !patch.includes(`-${'    '}${removedLog}`)) {
    fail(`the SDK diagnostic-log removal is missing for ${removedLog}`);
  }
}

const config = await readFile(join(mini, 'src', 'lib', 'fx', 'config.ts'), 'utf8');
if (!config.includes(scopeLock.sdkCommit)) {
  fail('the audited upstream commit is not recorded in the client scope contract');
}

const appDirectory = join(mini, 'src', 'app');
for (const entry of await readdir(appDirectory, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue;
  const page = join(appDirectory, entry.name, 'page.tsx');
  const hasPage = await stat(page).then((value) => value.isFile()).catch(() => false);
  if (hasPage && !allowedRoutes.has(entry.name)) fail(`unsupported active route /${entry.name}`);
}

const sourceFiles = (await walk(join(mini, 'src')))
  .filter((file) => /\.(?:ts|tsx)$/.test(file));
for (const file of sourceFiles) {
  const source = await readFile(file, 'utf8');
  for (const [label, pattern] of forbiddenSourcePatterns) {
    if (pattern.test(source)) fail(`${label} remains in ${relative(root, file)}`);
  }
}

const workflowDirectory = join(root, '.github', 'workflows');
const workflowFiles = (await walk(workflowDirectory)).filter((file) => /\.ya?ml$/.test(file));
for (const file of workflowFiles) {
  const workflow = await readFile(file, 'utf8');
  for (const match of workflow.matchAll(/\buses:\s*[^\s@]+@([^\s#]+)/g)) {
    if (!/^[0-9a-f]{40}$/i.test(match[1])) {
      fail(`workflow action is not pinned to a full commit SHA in ${relative(root, file)}: ${match[0]}`);
    }
  }
}

console.log(`FxAeon scope verified: ${expectedMethods.length} official methods, ${allowedRoutes.size} routes, no backend authority.`);
