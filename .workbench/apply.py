from pathlib import Path
import hashlib
updates = {}
def load(path, expected):
    raw=Path(path).read_bytes()
    sha=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    if sha != expected: raise RuntimeError(f'{path}: source changed ({sha})')
    updates[path]=raw.decode()
    return path

def replace(path,old,new,count=1):
    source=updates[path]
    if source.count(old)!=count: raise RuntimeError(f'{path}: expected {count} copies of {old[:90]!r}, found {source.count(old)}')
    updates[path]=source.replace(old,new)

def between(path,start,end,new):
    source=updates[path]
    if source.count(start)!=1 or source.count(end)!=1: raise RuntimeError(f'{path}: ambiguous anchors')
    a,b=source.index(start),source.index(end)
    if b<=a: raise RuntimeError('invalid range')
    updates[path]=source[:a]+new+source[b:]

p = load('apps/mini-app/src/components/PortfolioAssets.tsx', 'b3705c68cedb56e65a339876a270e442a226a640')
replace(p, "import TokenIcon from '@/components/TokenIcon';", "import { AssetIcon, AssetQuantity, AssetRowContent, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';\nexport { AssetIcon, AssetNetworkIcon, AssetQuantity, displayAssetSymbol, networkLabel } from '@/components/AssetPresentation';")
replace(p, "import { tokenName, tokenSymbol } from '@/lib/fx/tokenPresentation';", "import { tokenName } from '@/lib/fx/tokenPresentation';")
replace(p, "export const networkLabel = (chainId: number) => chainId === 8453 ? 'Base' : 'Ethereum';\n", '')
between(p, 'export function AssetIcon(', 'export function PortfolioAssets(', '')
replace(p, "onRetry, network = 'all' }: {", "onRetry, network = 'all', onNetworkChange }: {")
replace(p, '  network?: PortfolioNetwork;\n', '  network?: PortfolioNetwork;\n  onNetworkChange?: (value: PortfolioNetwork) => void;\n')
replace(p, "  const [search, setSearch] = useState('');", "  const [search, setSearch] = useState('');\n  const [expanded, setExpanded] = useState(false);")
replace(p, "useEffect(() => { setSelection(null); setSearch(''); }, [snapshot?.walletAddress]);", "useEffect(() => { setSelection(null); setSearch(''); setExpanded(false); }, [snapshot?.walletAddress]);\n  useEffect(() => { setExpanded(false); }, [network]);")
replace(p, '  const missingFreshValues = Boolean(displaySnapshot?.unpricedAssetCount);', "  const missingFreshValues = assets.some((asset) => asset.usdValue === null);\n  const showSearch = search.length > 0 || (displaySnapshot?.assets.filter((asset) => asset.balanceWei > 0n).length ?? 0) > 6;\n  const visibleAssets = expanded || query ? assets : assets.slice(0, 6);")
replace(p, '''    <label className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" autoComplete="off" /></label>
    {needsRefresh && <span className="sr-only" role="status" aria-live="polite">{statusLabel}</span>}''', '''    {onNetworkChange && <PortfolioNetworkTabs value={network} onChange={onNetworkChange} />}
    {showSearch && <label className={styles.search}><Search size={18} aria-hidden="true" /><span className="sr-only">Search assets</span><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search assets" autoComplete="off" /></label>}
    {needsRefresh && <p className="px-1 py-2 text-[12px] leading-relaxed text-mut" role="status">{statusLabel}</p>}''')
replace(p, '<ul className={styles.assetList}>{assets.map((asset)', '<ul className={styles.assetList}>{visibleAssets.map((asset)')
replace(p, '''        <AssetNetworkIcon asset={asset} /><span className={styles.assetName}><strong>{displayAssetSymbol(asset.symbol)}</strong><small>{networkLabel(asset.chainId)}</small></span>
        <span className={styles.assetWorth}><strong key={asset.usdValue} className={styles.changedValue}><ValueOrSkeleton value={formatUsd(asset.usdValue)} width="md" status={loading ? 'loading' : 'unavailable'} label="Asset value unavailable" /></strong><AssetQuantity asset={asset} /></span>''', '        <AssetRowContent asset={asset} loading={loading} />')
replace(p, '    {selected && <AssetSheet', '''    {!query && assets.length > 6 && <button type="button" className="min-h-11 w-full rounded-xl px-3 text-[12px] font-medium text-mint" onClick={() => setExpanded((value) => !value)}>{expanded ? 'Show fewer assets' : `View all ${assets.length} assets`}</button>}
    {selected && <AssetSheet''')
replace(p, "key === 'fxSAVE' ? '/earn?mode=claim'", "key === 'fxSAVE' ? '/earn'")
replace(p, 'width="md" label="Asset value unavailable"', 'width="md" status="unavailable" label="Asset value unavailable"')
replace(p, 'width="md" label="Current price unavailable"', 'width="md" status="unavailable" label="Current price unavailable"')

p = load('apps/mini-app/src/app/portfolio/page.tsx', '4de2e5201c2ee105eb2af7fe320daa2551ecafae')
replace(p, ', type ReactNode', '')
replace(p, '  Coins,\n', '')
replace(p, '  type WalletTokenBalance,\n', '')
replace(p, "import { tokenSymbol } from '@/lib/fx/tokenPresentation';\n", '')
replace(p, "import { AddressChip, AppShell, Card, SectionTitle } from '@/components/ui';", "import { AppShell, SectionTitle } from '@/components/ui';\nimport { ActionRow, Disclosure, MetricRows, PageHeading, ProductSurface, RowGroup, StatusNotice } from '@/components/ProductUI';\nimport { formatExactDecimal } from '@/lib/amount';\nimport { freshDisplayPrices } from '@/lib/displayPrices';\nimport presentation from '@/components/PortfolioWorkspace.module.css';")
replace(p, 'import { knownFreshPortfolioSubtotal, mergeFreshCanonicalWalletBalances }', 'import { canonicalWalletBalancesSnapshot, knownFreshPortfolioSubtotal, mergeFreshCanonicalWalletBalances }')
replace(p, 'import { displayAssetSymbol, PortfolioAssets, PortfolioNetworkTabs, type PortfolioNetwork }', 'import { PortfolioAssets, type PortfolioNetwork }')
between(p, '      <div className={`${styles.workspace} portfolio-dashboard stagger flex flex-col`}>', '        <PortfolioWallet />', '''      <div className={presentation.workspace}>
        <PageHeading title="Portfolio" />
''')
replace(p, '  const priceSnapshot = useUsdPrices();', '  const priceSnapshot = useUsdPrices();\n  const displayPrices = freshDisplayPrices(priceSnapshot);')
replace(p, "walletValuation(protocol.balances, priceSnapshot.prices, liveAssets.status === 'ready')", "walletValuation(protocol.balances, displayPrices, liveAssets.status === 'ready')")
replace(p, '''    ? mergeFreshCanonicalWalletBalances(liveAssets.data, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow)
    : null;''', '''    ? mergeFreshCanonicalWalletBalances(liveAssets.data, walletBalances.data, walletBalances.updatedAt, priceSnapshot, valuationNow)
    : canonicalWalletBalancesSnapshot(wallet.address, walletBalances.data, walletBalances.updatedAt, priceSnapshot, liveAssets.status === 'unavailable' ? 'unavailable' : 'pending', valuationNow);''')
replace(p, "positionIsStale(position, positionState.failedGroups) || priceSnapshot.status === 'stale'", "positionIsStale(position, positionState.failedGroups)")
replace(p, 'positionNetEquityUsd(position, priceSnapshot.prices)', 'positionNetEquityUsd(position, displayPrices)')
between(p, '  return (\n      <div id="overview" className={styles.overview}>', 'function DisconnectedPortfolio(', Path('.workbench/portfolio_render.txt').read_text())
between(p, 'function EarnPositionCard(', 'function SupportedValueCard(', Path('.workbench/portfolio_earn.txt').read_text())
between(p, 'function SupportedValueCard(', 'function QuickActions()', Path('.workbench/portfolio_value.txt').read_text())
replace(p, '<SectionTitle><span id="portfolio-actions-title">Actions</span></SectionTitle>', '<h2 id="portfolio-actions-title" className="sr-only">Actions</h2>')
replace(p, 'className={styles.actions}', 'className={presentation.quickActions}')
replace(p, 'className={`${styles.action} glass glass-press`}', 'className={presentation.quickAction}')
between(p, 'function ProtocolCard(', 'function PortfolioLoading()', '')
between(p, 'function fxSaveLabel(', 'function formatProtocolAmount(', '')

p = load('apps/mini-app/src/components/WalletProfile.tsx', '6179233a3b164984e37262d40234df45f163c504')
replace(p, "import { History, ChevronRight, ExternalLink, LogOut, RefreshCw, Settings, Wallet, X, type LucideIcon } from 'lucide-react';", "import { ArrowDownToLine, History, Layers2, ExternalLink, LogOut, RefreshCw, Settings, Wallet, X } from 'lucide-react';")
replace(p, "import { AssetNetworkIcon, AssetQuantity, networkLabel } from '@/components/PortfolioAssets';", "import { AssetRowContent, AssetQuantity, networkLabel } from '@/components/AssetPresentation';\nimport { ActionRow } from '@/components/ProductUI';\nimport presentation from '@/components/WalletProfile.module.css';")
replace(p, '  ProtocolPositionSkeleton,\n', '')
source=updates[p]
start=source.index('  return (\n    <>\n      <button\n        ref={openerRef}')
updates[p]=source[:start]+Path('.workbench/wallet_render.txt').read_text()
for path,content in updates.items():
    Path(path).write_text(content)
    print(f'Updated {path}')
