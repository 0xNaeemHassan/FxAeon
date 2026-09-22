from pathlib import Path
import hashlib
updates = {}
def load(path, expected):
    raw=Path(path).read_bytes()
    sha=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
    if sha != expected: raise RuntimeError(f'{path}: source changed ({sha})')
    updates[path]=raw.decode()
    return path

def replace(path, old, new, count=1):
    source=updates[path]
    if source.count(old) != count: raise RuntimeError(f'{path}: expected {count} copies of {old[:90]!r}, found {source.count(old)}')
    updates[path]=source.replace(old,new)

def between(path,start,end,new):
    source=updates[path]
    if source.count(start)!=1 or source.count(end)!=1: raise RuntimeError(f'{path}: ambiguous anchors')
    a,b=source.index(start),source.index(end)
    if b<=a: raise RuntimeError('invalid range')
    updates[path]=source[:a]+new+source[b:]

p = load('apps/mini-app/src/app/borrow/page.tsx', '7ba66303098d2953d1f9dc28e50c492809cf309c')
replace(p, ', type ReactNode', '')
replace(p, "import { Coins, RefreshCw } from 'lucide-react';\n", '')
replace(p, "import Link from 'next/link';\n", '')
replace(p, "import { AppShell, Button, Card, EmptyState } from '@/components/ui';", "import { AppShell } from '@/components/ui';\nimport { formatUnits } from 'viem';\nimport TokenIcon from '@/components/TokenIcon';\nimport ConnectWalletButton from '@/components/ConnectWalletButton';\nimport { MetricRows, PageHeading, ProductNav, ProductSurface, StatusNotice } from '@/components/ProductUI';\nimport { freshDisplayPrices } from '@/lib/displayPrices';\nimport { calculateNativeMax } from '@/lib/fx/nativeMax';\nimport { estimatePlannedRouteCost } from '@/lib/fx';")
replace(p, 'AmountField, InfoNote, Segmented', 'AmountField, Segmented')
replace(p, "import styles from '@/components/FlowWorkspace.module.css';", "import presentation from '@/components/BorrowWorkspace.module.css';")
replace(p, "type BorrowMode = 'mint' | 'manage';", "type BorrowMode = 'mint' | 'manage';\ntype ManagementAction = 'none' | 'add' | 'borrow' | 'repay' | 'withdraw' | 'combined';")
replace(p, "  const [mode, setMode] = useState<BorrowMode>('mint');", "  const [mode, setMode] = useState<BorrowMode>('mint');\n  const [managementAction, setManagementAction] = useState<ManagementAction>('none');")
replace(p, "  const changeMarket = useCallback((nextMarket: UiMarket) => {\n    setMarket(nextMarket);", "  const changeMarket = useCallback((nextMarket: UiMarket) => {\n    setManagementAction('none');\n    setMarket(nextMarket);")
replace(p, '''  const changePosition = useCallback((nextKey: string) => {
    setSelectedKey(nextKey);
    resetTransactionContext(collateralTokensForMarket(market)[0]);
  }, [market, resetTransactionContext]);''', '''  const changePosition = useCallback((nextKey: string) => {
    const next = positions.find((position) => positionKey(position) === nextKey);
    if (!next) return;
    setManagementAction('none');
    setMode('manage');
    setMarket(next.market);
    setSelectedKey(nextKey);
    resetTransactionContext(collateralTokensForMarket(next.market)[0]);
  }, [positions, resetTransactionContext]);''')
replace(p, "      setMode('mint');\n      setMarket('ETH');", "      setManagementAction('none');\n      setMode('mint');\n      setMarket('ETH');")
replace(p, '    setMode(restoredMode);', "    setMode(restoredMode);\n    setManagementAction('combined');")
replace(p, "    setMode('mint');\n    setMarket(requested.market);", "    setMode('mint');\n    setManagementAction('combined');\n    setMarket(requested.market);")
replace(p, '''      if (mode === 'mint') {
        return current === 'new' || positions.some((position) => positionKey(position) === current) ? current : 'new';
      }
      return positions.some((position) => positionKey(position) === current)
        ? current
        : positions[0]
          ? positionKey(positions[0])
          : '';''', '''      // Never retarget already-entered amounts when a selected position vanishes.
      if (mode === 'mint') return current || 'new';
      return current && current !== 'new' ? current : positions[0] ? positionKey(positions[0]) : '';''')
replace(p, '  const planBuilder = useMemo(() => {', Path('.workbench/borrow_native.txt').read_text()+'  const planBuilder = useMemo(() => {')
replace(p, '    if (selectedStale) return null;', "    if (selectedStale || selectedKey !== 'new' && !selected) return null;")
replace(p, "      if (depositWei === null || mintWei === null || (depositWei === 0n && mintWei === 0n)) return null;", "      if (depositWei === null || mintWei === null || (depositWei === 0n && mintWei === 0n) || selectedKey === 'new' && depositWei === 0n) return null;")
between(p, '  const actionCardVisible = ', 'function DisconnectedBorrowForm(', Path('.workbench/borrow_render.txt').read_text())
updates[p] = updates[p][:updates[p].index('function DisconnectedBorrowForm(')] + Path('.workbench/borrow_helpers.txt').read_text()
for path,content in updates.items():
    Path(path).write_text(content)
    print(f'Updated {path}')
