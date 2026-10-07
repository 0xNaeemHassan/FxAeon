import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const root = resolve(__dirname, '../..');
const esbuild = createRequire(createRequire(resolve(root, 'package.json')).resolve('tsx/package.json'))('esbuild') as {
  build: (options: Record<string, unknown>) => Promise<{ outputFiles: Array<{ path: string; text: string }> }>;
};
// Real Earn form, settings gear and summary CSS; local fixtures supply the
// protocol reads/planners and review shell. No wallet or transaction execution.
const mocks: Record<string, string> = {
  'next/link': `export default ({href,children,...props}) => <a href={href} {...props}>{children}</a>;`,
  'next/navigation': `export const useRouter = () => ({push:(href) => {history.pushState({},'',href);globalThis.__earnHarness.navigate();}});`,
  '@/components/ui': `export const AppShell = ({children}) => <main style={{padding:16}}>{children}</main>;`,
  '@/components/ProductUI': `export const PageHeading = ({title}) => <h1>{title}</h1>; export const ProductNav = () => <nav>Products</nav>; export const ProductSurface = ({children,...props}) => <section {...props}>{children}</section>; export const Disclosure = () => null; export const MetricRows = () => null; export const StatusNotice = ({title}) => <p>{title}</p>; export const ChoiceCards = () => null;`,
  '@/components/ProductSections': `export const EarnSections = () => null;`,
  '@/components/TokenIcon': `export default () => <span />;`,
  '@/components/MissingValue': `export const MissingValue = () => <span>Unavailable</span>; export const ValueOrSkeleton = ({value}) => <span>{value}</span>;`,
  '@/components/PriceProvider': `export const useUsdPrices = () => ({status:'ready',prices:{fxUSDBasePool:1,fxUSD:1},refresh:async () => {}});`,
  '@/lib/displayPrices': `export const freshDisplayPrices = snapshot => snapshot.prices;`,
  '@/lib/fxSaveApy': `export const fetchFxSaveApy = async () => ({apy:6.25});`,
  '@/lib/telegram': `export const haptic = () => {};`,
  '@/lib/fx/gasFeePolicy': `export const fetchGasTierQuotes = async () => ({tiers:{standard:{gasPriceWei:1n},fast:{gasPriceWei:2n},rapid:{gasPriceWei:3n}}});`,
  '@/lib/wallet': `export const usePrivyWallet = () => ({address:'0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',chainId:1,isEmbedded:true});`,
  '@/components/WalletDataProvider': `const refresh = async () => {}; export const useFxSaveClaimable = () => ({status:'ready',data:{hasPendingRedeem:false},refresh});`,
  '@/components/ProtocolForm': `export const AmountField = ({label,value,onChange}) => <label>{label}<input aria-label={label} value={value} onChange={event => onChange(event.target.value)} /></label>; export const TokenSelect = () => null; export const Segmented = ({options,onChange}) => <div>{options.map(option => <button key={option.value} onClick={() => onChange(option.value)}>{option.label}</button>)}</div>; const refresh = async () => {}; const balances = {fxUSD:{status:'ready',amount:'1000'}}; export const useWalletTokenBalances = () => ({status:'ready',balances,refresh});`,
  '@/components/ActionReview': `import React from 'react'; export const ActionReview = ({editor,planBuilder,resumeReview,onStageChange,label,blocker}) => {
    const [review,setReview] = React.useState(false); const resumed = React.useRef(false);
    const open = async () => {if (!planBuilder || blocker) return; await planBuilder();setReview(true);onStageChange('review');};
    React.useEffect(() => {if(resumeReview && planBuilder && !resumed.current){resumed.current=true;void open();}},[resumeReview,planBuilder]);
    return review ? <section aria-label="Earn review"><p>Review slippage: {globalThis.__earnHarness.plans.at(-1)?.slippage}%</p><button onClick={() => {setReview(false);onStageChange('input');}}>Edit</button></section> : <>{editor}<button disabled={!planBuilder || Boolean(blocker)} onClick={open}>{label}</button></>;
  };`,
  '@/lib/fx': `export const assertPublicClientChain = async () => {}; export const getEthereumClient = () => ({}); export const MAX_FX_SLIPPAGE_PERCENT = 2; export const assertConfiguredPublicClientChain = async () => {}; export const withReadDeadline = promise => promise;
    export const getFxReadFacade = () => ({getFxSaveConfig:async () => ({cooldownPeriodSeconds:3600n,instantRedeemFeeRatio:1000000000000000n,expenseRatio:0n,harvesterRatio:0n,threshold:0n,totalAssetsWei:1000n*10n**18n,totalSupplyWei:1000n*10n**18n}),getFxSaveBalance:async () => ({balanceWei:600n*10n**18n,assetsWei:62045n*10n**16n}),getFxSaveRedeemStatus:async () => ({hasPendingRedeem:false})});
    export const signatureDraftIdFromSearch = search => new URLSearchParams(search).get('fxDraft');
    export const restoreSignatureRequiredDraftFromSearch = (search,scope) => new URLSearchParams(search).has('fxDraft') && scope.actionKey === 'earn:deposit' ? ({draft:{resumePath:'/earn'},formState:{mode:'deposit',token:'fxUSD',amount:'10',shares:'',instant:true,slippage:new URLSearchParams(search).get('fixtureSlippage') ?? '2'}}) : undefined;
    export const planDepositFxSave = async input => {globalThis.__earnHarness.plans.push(input);return {};}; export const planWithdrawFxSave = planDepositFxSave; export const planRedeem = planDepositFxSave;`,
};
let script = '';
let css = '';

test.beforeAll(async () => {
  const result = await esbuild.build({
    stdin: {contents:`import React from 'react';import {createRoot} from 'react-dom/client';import EarnPage from './src/app/earn/page';import {TransactionSettings} from './src/components/TransactionSettings';
      const root = createRoot(document.getElementById('root'));
      globalThis.__earnHarness = {plans:[],showUncontrolled:() => root.render(<TransactionSettings slippage />),navigate:() => root.render(<button onClick={() => {history.pushState({},'', '/earn');root.render(<EarnPage />);}}>Return to Earn</button>)};
      root.render(<EarnPage />);`,loader:'tsx',resolveDir:root},
    bundle:true,write:false,format:'iife',platform:'browser',target:'es2022',jsx:'automatic',
    outdir:resolve(root,'test-results','earn-form-harness'),absWorkingDir:root,loader:{'.module.css':'local-css'},
    plugins:[{name:'earn-fixtures',setup(build:{
      onResolve:(options:{filter:RegExp},callback:(args:{path:string}) => unknown) => void;
      onLoad:(options:{filter:RegExp;namespace:string},callback:(args:{path:string}) => unknown) => void;
    }) {
      build.onResolve({filter:/^(@\/|next\/)/},({path}) => {
        if(mocks[path]) return {path,namespace:'fixture'};
        const base=resolve(root,'src',path.slice(2));
        return {path:[base,`${base}.ts`,`${base}.tsx`].find(existsSync) ?? base};
      });
      build.onLoad({filter:/.*/,namespace:'fixture'},({path}) => ({contents:mocks[path],loader:'tsx',resolveDir:root}));
    }}],
  });
  script=result.outputFiles.find(file => file.path.endsWith('.js'))!.text;
  css=result.outputFiles.find(file => file.path.endsWith('.css'))!.text;
});

async function mount(page:Page,resume=true,slippage='2') {
  await page.route('http://earn.test/**',route => route.fulfill({body:'<!doctype html><html><head></head><body><div id="root"></div></body></html>',contentType:'text/html'}));
  await page.goto(`http://earn.test/earn${resume ? `?fxDraft=fixture${slippage === '2' ? '' : `&fixtureSlippage=${slippage}`}` : ''}`);
  await page.evaluate(() => localStorage.setItem('fxaeon.settings.v1',JSON.stringify({slippageBps:50,gasTier:'standard'})));
  await page.addStyleTag({content:`*{box-sizing:border-box}body{margin:0;font-family:Arial,sans-serif;--fs-small:14px;--fs-caption:12px;--text:#111;--mut:#555;--surface:#fff;--surface-2:#eee;--line:#ccc;--success:#16803b;--radius-sm:8px;--dur-fast:0ms}button{font:inherit;border:0;padding:0;cursor:pointer;background:none}${css}`});
  await page.addScriptTag({content:script});
  if(resume) await expect(page.getByRole('region',{name:'Earn review'})).toContainText(`Review slippage: ${slippage}%`);
  else await expect(page.getByText('600 fxSAVE',{exact:true})).toBeVisible();
}
async function openSettings(page:Page,percent:string) {
  await page.getByRole('button',{name:`Transaction settings, ${percent}% slippage`,exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Transaction settings',exact:true});
  await expect(dialog.getByRole('textbox',{name:'Slippage tolerance percentage'})).toHaveValue(percent);
  return dialog;
}
async function storedSlippage(page:Page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('fxaeon.settings.v1')!).slippageBps);
}

test('resumed slippage is displayed, preserved by gas edits and used by review',async ({page}) => {
  await mount(page);
  await expect(page).toHaveURL('http://earn.test/earn');
  expect(await storedSlippage(page)).toBe(50);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  let dialog=await openSettings(page,'2');
  await expect(dialog.getByRole('radio',{name:'2%',exact:true})).toHaveAttribute('aria-checked','true');
  await dialog.getByRole('textbox',{name:'Slippage tolerance percentage'}).focus();
  await dialog.getByRole('radio',{name:/Fast/}).click();
  expect(await storedSlippage(page)).toBe(50);
  await expect(dialog.getByRole('textbox',{name:'Slippage tolerance percentage'})).toHaveValue('2');
  await dialog.getByRole('button',{name:'Close transaction settings'}).click();
  await page.getByRole('button',{name:'Review deposit',exact:true}).click();
  await expect(page.getByRole('region',{name:'Earn review'})).toContainText('Review slippage: 2%');
  expect(await storedSlippage(page)).toBe(50);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  dialog=await openSettings(page,'2');
  // An explicit choice must apply even when it matches the saved preference.
  await dialog.getByRole('radio',{name:'0.5%',exact:true}).click();
  await expect(dialog.getByRole('textbox',{name:'Slippage tolerance percentage'})).toHaveValue('0.5');
  await dialog.getByRole('button',{name:'Close transaction settings'}).click();
  await page.getByRole('button',{name:'Review deposit',exact:true}).click();
  await expect(page.getByRole('region',{name:'Earn review'})).toContainText('Review slippage: 0.5%');
});

test('navigation does not save a restored draft; explicit custom edits persist',async ({page}) => {
  await mount(page);
  await page.getByRole('button',{name:'Edit',exact:true}).click();
  let dialog=await openSettings(page,'2');
  await dialog.getByRole('link',{name:'All settings'}).click();
  await expect(page).toHaveURL('http://earn.test/settings');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await storedSlippage(page)).toBe(50);
  await page.getByRole('button',{name:'Return to Earn'}).click();
  dialog=await openSettings(page,'0.5');
  const input=dialog.getByRole('textbox',{name:'Slippage tolerance percentage'});
  await input.fill('0.75'); await input.press('Enter');
  await expect(input).toHaveValue('0.75');
  expect(await storedSlippage(page)).toBe(75);
  await dialog.getByRole('button',{name:'Close transaction settings'}).click();
  await page.getByLabel('Deposit amount',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Review deposit',exact:true}).click();
  await expect(page.getByRole('region',{name:'Earn review'})).toContainText('Review slippage: 0.75%');
});

test('fxSAVE units wrap as a row at narrow widths and enlarged text',async ({page}) => {
  await mount(page,false);
  for(const width of [320,390,768]) {
    await page.setViewportSize({width,height:844});
    const units=page.getByText('600 fxSAVE',{exact:true});
    const check=async () => {
      const geometry=await units.evaluate(element => {
        const range=document.createRange();range.selectNodeContents(element);
        const rects=[...range.getClientRects()];const parent=element.parentElement!.getBoundingClientRect();
        return {lines:new Set(rects.map(rect => rect.top)).size,contained:rects.every(rect => rect.left>=parent.left && rect.right<=parent.right+1),overflow:document.documentElement.scrollWidth>innerWidth};
      });
      expect(geometry).toEqual({lines:1,contained:true,overflow:false});
    };
    await check();
    await units.evaluate((element:HTMLElement) => {element.style.fontSize='24px';});
    await check();
    await units.evaluate((element:HTMLElement) => {element.style.fontSize='';});
  }
});

test('changed stored slippage reaches a restored form while unrelated storage changes do not', async ({ page }) => {
  await mount(page);
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  await page.evaluate(() => {
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 50, gasTier: 'rapid' }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'fxaeon.settings.v1' }));
  });
  await expect(page.getByRole('button', { name: 'Transaction settings, 2% slippage', exact: true })).toBeVisible();
  await page.evaluate(() => {
    localStorage.setItem('fxaeon.settings.v1', JSON.stringify({ slippageBps: 75 }));
    window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated-setting' }));
  });
  await expect(page.getByRole('button', { name: 'Transaction settings, 2% slippage', exact: true })).toBeVisible();
  await page.evaluate(() => window.dispatchEvent(new StorageEvent('storage', { key: 'fxaeon.settings.v1' })));
  const dialog = await openSettings(page, '0.75');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await input.fill('3');
  await input.press('Enter');
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(input).toHaveValue('0.75');
  expect(await storedSlippage(page)).toBe(75);
  await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  await page.getByRole('button', { name: 'Review deposit', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Earn review' })).toContainText('Review slippage: 0.75%');
});

for (const percent of ['0.29', '0.14', '0.57', '1.1', '0.291', '0.101']) {
  test(`restored ${percent}% remains unchanged by focus, blur and gas selection`, async ({ page }) => {
    await mount(page, true, percent);
    await page.getByRole('button', { name: 'Edit', exact: true }).click();
    const dialog = await openSettings(page, percent);
    const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
    await input.focus();
    await input.blur();
    await expect(input).toHaveValue(percent);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await storedSlippage(page)).toBe(50);
    await input.focus();
    await dialog.getByRole('radio', { name: /Fast/ }).click();
    await expect(input).toHaveValue(percent);
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    expect(await storedSlippage(page)).toBe(50);
    await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
    await page.getByRole('button', { name: 'Review deposit', exact: true }).click();
    await expect(page.getByRole('region', { name: 'Earn review' })).toContainText(`Review slippage: ${percent}%`);
  });
}


test('uncontrolled settings still announce an explicit saved-value commit', async ({ page }) => {
  await mount(page, false);
  await page.evaluate(() => {
    const harness = globalThis as typeof globalThis & { __earnHarness: { showUncontrolled: () => void } };
    harness.__earnHarness.showUncontrolled();
    document.documentElement.dataset.settingsUpdates = '0';
    window.addEventListener('fxaeon:settings-updated', () => {
      const root = document.documentElement;
      root.dataset.settingsUpdates = String(Number(root.dataset.settingsUpdates) + 1);
    });
  });
  const dialog = await openSettings(page, '0.5');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await input.focus();
  await input.blur();
  await expect(page.locator('html')).toHaveAttribute('data-settings-updates', '1');
  expect(await storedSlippage(page)).toBe(50);
});


test('editing a finer restored percentage still requires whole-basis-point preferences', async ({ page }) => {
  await mount(page, true, '0.291');
  await page.getByRole('button', { name: 'Edit', exact: true }).click();
  const dialog = await openSettings(page, '0.291');
  const input = dialog.getByRole('textbox', { name: 'Slippage tolerance percentage' });
  await input.fill('0.292');
  await input.blur();
  await expect(input).toHaveValue('0.291');
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByRole('alert')).toContainText('steps of 0.01%');
  expect(await storedSlippage(page)).toBe(50);
  await input.fill('0.29');
  await input.blur();
  await expect(input).toHaveValue('0.29');
  await expect(input).toHaveAttribute('aria-invalid', 'false');
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(await storedSlippage(page)).toBe(29);
  await dialog.getByRole('button', { name: 'Close transaction settings' }).click();
  await page.getByRole('button', { name: 'Review deposit', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Earn review' })).toContainText('Review slippage: 0.29%');
});
