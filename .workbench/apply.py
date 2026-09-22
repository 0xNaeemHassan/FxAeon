from pathlib import Path
import hashlib

updates = {}
def load(path, expected):
    raw = Path(path).read_bytes()
    sha = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if sha != expected: raise RuntimeError(f'{path}: source changed ({sha})')
    updates[path] = raw.decode()
    return path

def replace(path, old, new, count=1):
    source = updates[path]
    if source.count(old) != count: raise RuntimeError(f'{path}: expected {count} copies of {old[:90]!r}, found {source.count(old)}')
    updates[path] = source.replace(old, new)

def between(path, start, end, new):
    source = updates[path]
    if source.count(start) != 1 or source.count(end) != 1: raise RuntimeError(f'{path}: ambiguous anchors')
    a, b = source.index(start), source.index(end)
    if b <= a: raise RuntimeError('invalid range')
    updates[path] = source[:a] + new + source[b:]

p = load('apps/mini-app/src/components/ProtocolForm.tsx', '89ff7b27713ccfb84bc161e2f50bc3dbeb947024')
between(p, 'export function AmountField({', 'export function TokenSelect', "export { AmountField } from './AmountField';\nexport type { AmountFieldProps } from './AmountField';\n\n")
replace(p, 'type CSSProperties, ', '')
replace(p, 'calculateFractionDecimal, compareExactDecimals, decimalInputError, formatExactDecimal, positiveDecimal', 'formatExactDecimal')
replace(p, 'formatUsd, formatUsdPrice, priceKeyForSymbol, usdValueForDecimal, type UsdPriceMap', 'priceKeyForSymbol, type UsdPriceMap')

p = load('apps/mini-app/src/components/ui.tsx', '079c62430acd633b31356ed62821b815a3736cf8')
replace(p, 'type ButtonHTMLAttributes, type MouseEventHandler', 'type ButtonHTMLAttributes, type HTMLAttributes, type MouseEventHandler')
replace(p, 'data-shell-tabs={tabs', 'data-product-ui="v2"\n      data-shell-tabs={tabs')
replace(p, '<NetworkSelector />\n              <ThemeToggle />\n              <WalletProfile />', '<NetworkSelector />\n              <WalletProfile />\n              <ThemeToggle />')
between(p, 'export function Card({', 'function buttonClasses', '''export function Card({ children, className = '', glow = false, elevation = 1, ...props }: HTMLAttributes<HTMLDivElement> & { glow?: boolean; elevation?: 1 | 2 | 3 }) {
  const elevationClass = elevation === 2 || elevation === 3 ? 'astryx-card-elevated' : 'astryx-card';
  return <div {...props} className={`ui-card ${elevationClass} p-5 ${glow ? 'card-glow' : ''} ${className}`}>{children}</div>;
}

''')

p = load('apps/mini-app/src/app/layout.tsx', '687407e6484ce47da30f88f9efdee63f7c61d1d3')
replace(p, "import './globals.css';", "import './globals.css';\nimport './product-shell.css';")

p = load('apps/mini-app/src/app/trade/page.tsx', 'd688ebc5e728575dfd3fa98f478bbd0f56ad60c1')
replace(p, "import { AppShell, Card } from '@/components/ui';", "import { AppShell, Card } from '@/components/ui';\nimport { Disclosure } from '@/components/ProductUI';")
replace(p, '<div className={styles.tradeLayout}>', '<div className={styles.tradeLayout} data-trade-layout>')
replace(p, '<div className={styles.marketColumn}>', '<div className={styles.marketColumn} data-trade-market>')
replace(p, '<div className={styles.ticketColumn}>', '<div className={styles.ticketColumn} data-trade-ticket>')
start = '                    <details className={`${styles.advancedDetails} group rounded-xl border border-[var(--line)] px-3`}>\n'
end = '                    </details>'
between(p, start, end, '''                    <Disclosure title="Settings" summary={`${slippage}% slippage`}>
                      <SlippageField value={slippage} onChange={changeSlippage} max={MAX_FX_SLIPPAGE_PERCENT} />
''')
replace(p, end, '                    </Disclosure>')

p = load('apps/mini-app/src/app/move/page.tsx', '56420f66420b37632edb2beec22238679d56b6da')
replace(p, "import { AppShell, Card } from '@/components/ui';", "import { AppShell, Card } from '@/components/ui';\nimport { PageHeading } from '@/components/ProductUI';")
replace(p, '        <Card\n          data-flow-stage', '        <PageHeading title="Move" />\n        <Card\n          data-flow-stage')
replace(p, '''          <div className="flex items-center justify-between gap-3">
            <div>
              <h1 className="text-[22px] font-semibold tracking-[-.03em]">Move</h1>
            </div>
          </div>

''', '')
replace(p, 'className={`mt-5 ${styles.networkFlow}', 'className={`${styles.networkFlow}')
replace(p, '''            {!advanced && (
              <TokenSelect label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={changeToken} balances={moveBalances} balanceStatus={wallet.address ? moveBalanceStatusForPicker : 'disconnected'} />
            )}

''', '')
replace(p, '                hint={`Available on ${sourceName}`}\n', '')
replace(p, '                balanceState={moveBalanceState}\n', '''                balanceState={moveBalanceState}
                showUnitPrice={false}
                tokenSelector={!advanced ? <TokenSelect compact label="Asset" value={token} options={['fxUSD', 'fxSAVE'] as const} onChange={changeToken} balances={moveBalances} balanceStatus={wallet.address ? moveBalanceStatusForPicker : 'disconnected'} /> : undefined}
''')
replace(p, '<span className="text-[12px] font-medium text-mut">Recipient</span>', '<span className="text-[12px] font-medium text-mut">Recipient on {destinationName}</span>')

for path, content in updates.items():
    Path(path).write_text(content)
    print(f'Updated {path}')
