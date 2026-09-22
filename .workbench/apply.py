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

p = load('apps/mini-app/src/app/earn/page.tsx', '86dcb51f8830b289512eaac054475c37cf365b65')
replace(p, ', type ReactNode', '')
replace(p, "import { ChevronDown, RefreshCw } from 'lucide-react';", "import { ArrowLeft, RefreshCw } from 'lucide-react';")
replace(p, "import Link from 'next/link';\n", '')
replace(p, "import { AppShell, Button, Card } from '@/components/ui';", "import { AppShell } from '@/components/ui';\nimport { ChoiceCards, Disclosure, MetricRows, PageHeading, ProductNav, ProductSurface, StatusNotice } from '@/components/ProductUI';\nimport { freshDisplayPrices } from '@/lib/displayPrices';")
replace(p, 'AmountField, InfoNote, Segmented, SlippageField, ToggleRow, TokenSelect', 'AmountField, Segmented, SlippageField, TokenSelect')
replace(p, "import styles from '@/components/FlowWorkspace.module.css';", "import presentation from '@/components/SavingsWorkspace.module.css';")
between(p, '  return (\n    <AppShell>', 'type SaveConfig =', Path('.workbench/earn_render.txt').read_text())
source = updates[p]
start = source.index('function SavingsSummary(')
updates[p] = source[:start] + Path('.workbench/earn_helpers.txt').read_text()
for path, content in updates.items():
    Path(path).write_text(content)
    print(f'Updated {path}')
