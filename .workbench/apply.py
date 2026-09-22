from pathlib import Path
import hashlib

updates = {}
def load(path, expected=None):
    raw = Path(path).read_bytes()
    sha = hashlib.sha1(b'blob ' + str(len(raw)).encode() + b'\0' + raw).hexdigest()
    if expected and sha != expected: raise RuntimeError(f'{path}: source changed ({sha})')
    updates[path] = raw.decode()
    return path

def replace(path, old, new, count=1):
    source = updates[path]
    if source.count(old) != count: raise RuntimeError(f'{path}: expected {count} copies of {old[:90]!r}, found {source.count(old)}')
    updates[path] = source.replace(old, new)

p = load('apps/mini-app/src/components/ActionReview.tsx', '94b424e1458c77d2aeea6a22aa511ed7881cd270')
replace(p, '  editor?: ReactNode;', '  editor?: ReactNode;\n  /** Product forms require review before requesting a wallet signature. */\n  reviewBeforeSign?: boolean;')
replace(p, "  surface = 'card',", "  surface = 'card',\n  reviewBeforeSign = false,")
replace(p, "    const previewAction = previewRoute ? actionButtonLabel(label, operationLabel) : null;", "    const reviewLabel = /^review\\b/i.test(label) ? label : `Review ${actionButtonLabel(label, operationLabel).replace(/^(open|send)\\s+/i, '').toLowerCase()}`;\n    const previewAction = previewRoute ? reviewBeforeSign ? reviewLabel : actionButtonLabel(label, operationLabel) : null;")
replace(p, 'onClick={() => void execute(previewRoute ?? undefined)}', 'onClick={() => { if (reviewBeforeSign) void review(); else void execute(previewRoute ?? undefined); }}')
replace(p, "{previewAction ?? (previewLoading ? 'Updating quote' : actionButtonLabel(label, operationLabel))}", "{previewAction ?? (previewLoading ? 'Updating quote' : reviewBeforeSign ? reviewLabel : actionButtonLabel(label, operationLabel))}")

for page in ['trade', 'earn', 'borrow', 'move']:
    p = load(f'apps/mini-app/src/app/{page}/page.tsx')
    source = updates[p]
    count = source.count('<ActionReview')
    if not 1 <= count <= 3: raise RuntimeError(f'{page}: unexpected review count {count}')
    updates[p] = source.replace('<ActionReview', '<ActionReview reviewBeforeSign')

p = load('apps/mini-app/src/components/PortfolioAssets.tsx')
replace(p, 'import { AssetIcon, AssetQuantity, AssetRowContent, displayAssetSymbol, networkLabel }', 'import { AssetQuantity, AssetRowContent, displayAssetSymbol, networkLabel }')

p = load('apps/mini-app/src/components/WalletProfile.tsx')
source = updates[p]
anchor = "'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])'"
if anchor in source: replace(p, anchor, "'a[href], button:not([disabled]), summary, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex=\"-1\"])'")
else: raise RuntimeError('Wallet focusable selector changed')
p = load('apps/mini-app/src/components/WalletProfile.module.css')
replace(p, 'color: var(--bg);', 'color: var(--on-accent);')

p = load('apps/mini-app/e2e/harness/action-review-entry.tsx', '885895f72f114e136e188b02ebd34ce1d0bdb009')
replace(p, '  const [resumeReview, setResumeReview] = useState(0);', '  const [resumeReview, setResumeReview] = useState(0);\n  const [reviewBeforeSign, setReviewBeforeSign] = useState(false);')
replace(p, '    <div role="toolbar">', '    <div role="toolbar">\n      <button type="button" onClick={() => setReviewBeforeSign(true)}>Use explicit review</button>')
replace(p, '    <ActionReview\n', '    <ActionReview\n      reviewBeforeSign={reviewBeforeSign}\n')

p = load('apps/mini-app/e2e/specs/action-review-harness.spec.ts', '60739b9c08fe5a3ddf232ebd106a414aedb772a5')
anchor = "  test.beforeAll(async () => { bundle = await buildHarness(); });"
replace(p, anchor, anchor + '''

  test('explicit review never signs until the separate confirmation action', async ({ page }) => {
    await openHarness(page);
    await page.getByRole('button', { name: 'Use explicit review', exact: true }).click();
    const review = page.getByRole('button', { name: 'Review position', exact: true });
    await expect(review).toBeEnabled();
    await review.click();
    const confirm = page.getByRole('button', { name: 'Confirm in wallet', exact: true });
    await expect(confirm).toBeVisible();
    expect(await metric(page, 'runner')).toBe(0);
    expect(await metric(page, 'send')).toBe(0);
    await confirm.click();
    await expect(page.getByRole('heading', { name: 'Confirmed', exact: true })).toBeVisible();
    expect(await metric(page, 'runner')).toBe(1);
    expect(await metric(page, 'send')).toBe(1);
  });
''')

for path, content in updates.items():
    Path(path).write_text(content)
    print(f'Updated {path}')
