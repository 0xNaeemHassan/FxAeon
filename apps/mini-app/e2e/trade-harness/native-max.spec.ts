import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { test, expect } from '@playwright/test';

const root = resolve(__dirname, '../../../..');
const require = createRequire(resolve(root, 'package.json'));
const tsxPackage = require.resolve('tsx/package.json', { paths: [resolve(root, 'apps/mini-app')] });
const esbuild = createRequire(tsxPackage)('esbuild') as { build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ text: string }> }> };
const src = resolve(root, 'apps/mini-app/src');
const entry = resolve(root, 'apps/mini-app/e2e/harness/trade-native-max-entry.tsx');

const mocks: Record<string, string> = {
  'next/link': `import React from 'react'; export default ({children,...props}) => <a {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({ push: () => {} });`,
  '@/components/ui': `import React from 'react'; export const AppShell = ({children}) => <main>{children}</main>; export const Card = ({children,...props}) => <section {...props}>{children}</section>;`,
  '@/components/ProductUI': `import React from 'react'; export const Disclosure = ({children}) => <>{children}</>;`,
  '@/components/ProductLayout': `import React from 'react'; export const ActionWorkspace = ({children,...props}) => <section {...props}>{children}</section>;`,
  '@/components/ActionReview': `import React from 'react'; export const ActionReview = ({editor, label}) => <>{editor}<button type="button">{label}</button></>;`,
  '@/components/MarketChart': `import React from 'react'; export const TradeMarketChart = () => null;`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({status:'unavailable',prices:{}});`,
  '@/components/TokenIcon': `import React from 'react'; export default () => <span />;`,
  '@/components/MissingValue': `import React from 'react'; export const ValueOrSkeleton = ({value}) => <span>{value}</span>;`,
  '@/components/ProtocolPositionCard': `export const ProtocolPositionCard = () => null; export const ProtocolPositionNotice = () => null;`,
  '@/components/ProtocolPositionProvider': `export const useProtocolPositions = () => ({positions:[],pendingPositions:[],status:'ready',failedGroups:[],refresh:async()=>({positions:[],failedGroups:[],successfulGroups:[],status:'ready',newPositions:[]})});`,
  '@/components/ConfirmedPositionCards': `export const ConfirmedPositionCards = () => null;`,
  '@/lib/confirmedPositions': `export const deriveConfirmedPositionHint = () => null;`,
  '@/lib/confirmedPositionStorage': `export const confirmedPositionHintKey = () => '';`,
  '@/components/ProtocolForm': `import React from 'react'; export { AmountFieldView as AmountField } from '@/components/AmountField'; export const LeverageField = () => null; export const Segmented = ({options,value,onChange,ariaLabel}) => <div role="group" aria-label={ariaLabel}>{options.map(o=><button type="button" key={o.value} aria-pressed={value===o.value} onClick={()=>onChange(o.value)}>{o.label}</button>)}</div>; export const SlippageField = () => null; export const TokenSelect = ({label,value,options,onChange}) => <select aria-label={label} value={value} onChange={e=>onChange(e.target.value)}>{options.map(o=><option key={o} value={o}>{o}</option>)}</select>; export const tokenBalanceFor = (balances,token) => balances[token]; export const useWalletTokenBalances = () => ({balances:{ETH:{status:'ready',amount:globalThis.__tradeMaxHarness.balance}},status:'ready',refresh:async()=>{}});`,
  '@/lib/fx': `export const MAX_FX_SLIPPAGE_PERCENT=5; export const clampLeverage=(v)=>v; export const estimatePlannedRouteCost=async()=>({}); export const getEthereumClient=()=>({getBlockNumber:async()=>1n}); export const leverageBoundsFor=()=>({min:1,max:10}); export const planIncreasePosition=async(input)=>({input}); export const prepareLeverageReview=async()=>({}); export const readLeverageBounds=async()=>({min:1,max:10}); export const readSignatureRequiredDraft=()=>null; export const restoreSignatureRequiredDraft=()=>null; export const signatureDraftIdFromSearch=()=>null;`,
  '@/lib/fx/nativeMax': `export const nativeMaxErrorMessage=()=> 'Current gas fees are unavailable. Try again shortly.'; export const calculateNativeMax = (input) => new Promise((resolve,reject) => globalThis.__tradeMaxHarness.requests.push({balanceWei:input.balanceWei,resolve,reject}));`,
  '@/lib/fx/routePrefetch': `export class RoutePrefetchStore { invalidate(){} prime(){return Promise.resolve();} get(){return null;} }`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({ready:true,authenticated:true,address:globalThis.__tradeMaxHarness.address,chainId:globalThis.__tradeMaxHarness.chainId,connectionVersion:1,isEmbedded:true,wallets:[],sendTransaction:async()=>({})});`,
  '@/lib/amount': `export const positiveDecimal = (value) => /^\\d+(\\.\\d*)?$/.test(value); export const calculateFractionDecimal=(value,fraction)=>value; export const compareExactDecimals=(left,right)=>Number(left)-Number(right); export const decimalInputError=()=>null; export const formatExactDecimal=(value)=>String(value); export const normalizeAmountInput=(value)=>value;`,
  '@/lib/prices': `export const formatUsd=()=> '$0.00'; export const formatUsdPrice=()=> '$0.00'; export const priceKeyForSymbol=()=> null; export const usdValueForDecimal=()=> null;`,
  '@/lib/fx/tokenPresentation': `export const tokenSymbol=(value)=>value;`,
  '@/lib/telegram': `export const haptic=()=>{};`,
  '@/lib/walletAssets': `export const ASSET_PRICE_MAX_AGE_MS=60000;`,
  '@/lib/settings': `export const DEFAULT_SLIPPAGE_PERCENT=0.5; export const readSlippagePercent=()=>0.5; export const readGasTier=()=> 'standard'; export const SETTINGS_KEY='settings'; export const SETTINGS_UPDATED_EVENT='settings-updated';`,
  '@/lib/transactionState': `export const readTradeDeepLinkContext=()=>null; export const resetTransactionAmounts=()=>({amount:'',leverage:2});`,
  '@/app/trade/fxUi': `export const parseAmount=(value)=>value ? BigInt(Math.round(Number(value)*1e18)) : null; export const positionInputTokenOptions=(market)=>market==='ETH'?['ETH','WETH','stETH','wstETH']:['WBTC']; export const positionKey=()=>''; export const tokenAddress=()=> '0x0000000000000000000000000000000000000001'; export const tokenDecimals=()=>18;`,
};

async function buildHarness(): Promise<string> {
  type BuildApi = { onResolve: (options: { filter: RegExp }, callback: (args: { path: string; resolveDir?: string }) => unknown) => void; onLoad: (options: { filter: RegExp; namespace?: string }, callback: (args: { path: string; resolveDir: string }) => unknown) => void };
  const result = await esbuild.build({
    entryPoints: [entry], bundle: true, write: false, format: 'iife', platform: 'browser', target: 'es2020', jsx: 'automatic',
    loader: { '.tsx': 'tsx', '.ts': 'ts' }, absWorkingDir: root,
    plugins: [{ name: 'trade-native-max-harness', setup(build: BuildApi) {
      build.onResolve({ filter: /^@\// }, (args) => {
        if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
        const candidate = resolve(src, args.path.slice(2));
        if (args.path.endsWith('.module.css')) return { path: candidate, namespace: 'empty-css' };
        if (existsSync(candidate)) return { path: candidate };
        for (const ext of ['.tsx', '.ts']) if (existsSync(`${candidate}${ext}`)) return { path: `${candidate}${ext}` };
        return { path: candidate };
      });
      build.onResolve({ filter: /^next\/link$/ }, () => ({ path: 'next/link', namespace: 'mock' }));
      build.onResolve({ filter: /^next\/navigation$/ }, () => ({ path: 'next/navigation', namespace: 'mock' }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: resolve(root, 'apps/mini-app') }));
      build.onResolve({ filter: /\.module\.css$/ }, (args) => ({ path: resolve(args.resolveDir ?? root, args.path), namespace: 'empty-css' }));
      build.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: 'export default {};', loader: 'js' }));
    } }],
  });
  return result.outputFiles[0].text;
}

let bundle = '';
test.beforeAll(async () => { bundle = await buildHarness(); });
type Control = { balance: string; requests: Array<{ balanceWei: bigint; resolve: (value: bigint) => void; reject: (error: Error) => void }>; rerender?: () => void };

async function mount(page: import('@playwright/test').Page) {
  page.on('pageerror', (error) => console.error('[trade harness pageerror]', error));
  page.on('console', (message) => { if (message.type() === 'error') console.error('[trade harness console]', message.text()); });
  await page.setContent('<div id="root"></div>');
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('html[data-harness-ready="true"]')).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toBeVisible();
}
async function resolveRequest(page: import('@playwright/test').Page, index: number, amount: string) {
  await page.evaluate(({ index, amount }) => {
    const h = (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness;
    h.requests[index].resolve(BigInt(Math.round(Number(amount) * 1e18)));
  }, { index, amount });
}
async function rejectRequest(page: import('@playwright/test').Page, index: number) {
  await page.evaluate((index) => {
    const h = (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness;
    h.requests[index].reject(new Error('gas estimate unavailable'));
  }, index);
}

test('StrictMode Max calculation resolves into the amount field', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect(max).toBeDisabled();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(1);
  await resolveRequest(page, 0, '0.9');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.9');
  await expect(max).toBeEnabled();
});

test('balance changes discard an in-flight Max result and restore the button', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect(max).toBeDisabled();
  await page.evaluate(() => {
    const h = (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness;
    h.balance = '2'; h.rerender?.();
  });
  await expect(max).toBeEnabled();
  await resolveRequest(page, 0, '0.9');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('');
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(2);
  const balanceWei = await page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests[1].balanceWei.toString());
  expect(balanceWei).toBe('2000000000000000000');
});

test('changing Long/Short cancels the pending Max result', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect(max).toBeDisabled();
  await page.getByRole('group', { name: 'Position side' }).getByRole('button', { name: 'Short' }).click();
  await expect(max).toBeEnabled();
  await resolveRequest(page, 0, '0.8');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('');
});

test('a failed Max request can be retried and each click recalculates', async ({ page }) => {
  await mount(page);
  const max = page.getByRole('button', { name: 'Calculate 100% after gas reserve' });
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(1);
  await rejectRequest(page, 0);
  await expect(page.getByText(/current gas fees are unavailable/i)).toBeVisible();
  await expect(max).toBeEnabled();
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(2);
  await resolveRequest(page, 1, '0.7');
  await expect(page.getByRole('textbox', { name: 'Amount in ETH' })).toHaveValue('0.7');
  await max.click();
  await expect.poll(async () => page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.length)).toBe(3);
  const balances = await page.evaluate(() => (globalThis as typeof globalThis & { __tradeMaxHarness: Control }).__tradeMaxHarness.requests.map((request) => request.balanceWei.toString()));
  expect(balances).toEqual(['1000000000000000000','1000000000000000000','1000000000000000000']);
});
