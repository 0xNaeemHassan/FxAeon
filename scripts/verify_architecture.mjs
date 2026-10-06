import { readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = join(root, 'apps', 'mini-app', 'src');

async function walk(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await walk(path));
    else if (/\.(?:ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function fail(message) {
  throw new Error(`FxAeon architecture verification failed: ${message}`);
}

// Inspect the TypeScript syntax tree instead of searching raw text. Product
// copy and comments can name the SDK; only module syntax or a runtime module
// load escapes the audited boundary.
export function hasDirectSdkImport(source, fileName = 'architecture-contract.ts') {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const isTarget = (node) => Boolean(node && ts.isStringLiteralLike(node) && node.text === '@aladdindao/fx-sdk');
  let found = false;
  const visit = (node) => {
    if (found) return;
    if (ts.isImportDeclaration(node) && isTarget(node.moduleSpecifier)) found = true;
    else if (ts.isExportDeclaration(node) && isTarget(node.moduleSpecifier)) found = true;
    else if (ts.isImportEqualsDeclaration(node)
      && ts.isExternalModuleReference(node.moduleReference)
      && isTarget(node.moduleReference.expression)) found = true;
    else if (ts.isImportTypeNode(node)
      && ts.isLiteralTypeNode(node.argument)
      && isTarget(node.argument.literal)) found = true;
    else if (ts.isCallExpression(node) && node.arguments.length === 1 && isTarget(node.arguments[0])) {
      const expression = node.expression;
      if (expression.kind === ts.SyntaxKind.ImportKeyword
        || (ts.isIdentifier(expression) && expression.text === 'require')) found = true;
    }
    if (!found) ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}

const directSdkAllowlist = new Set([
  'apps/mini-app/src/app/trade/fxUi.ts',
  'apps/mini-app/src/app/trade/canonicalPositionReader.ts',
  'apps/mini-app/src/components/BridgeTracker.tsx',
  'apps/mini-app/src/lib/confirmedPositions.ts',
]);

for (const file of await walk(sourceRoot)) {
  const source = await readFile(file, 'utf8');
  const name = relative(root, file).replaceAll('\\', '/');
  const isFacade = name.startsWith('apps/mini-app/src/lib/fx/');
  if (hasDirectSdkImport(source)
    && !isFacade && !directSdkAllowlist.has(name)) {
    fail(`direct SDK import must stay behind the fx façade or an audited display adapter: ${name}`);
  }
  if (/from\s+["']@\/lib\/fx\/sdk["']/.test(source) && !isFacade) {
    fail(`SDK singleton import escaped the fx façade: ${name}`);
  }
  // Keep the process-wide SDK singleton private even when a route tries to
  // reach it through the barrel export (`@/lib/fx`). Product code should use
  // the typed read façade or the service boundary instead.
  if (/\b(?:getFxSdk|createFxSdkFacade)\s*\(/.test(source) && !isFacade) {
    fail(`SDK singleton construction escaped the fx façade: ${name}`);
  }
  if (/\bnew\s+(?:Shared)?Worker\s*\(|navigator\.serviceWorker\.register\s*\(|\bimportScripts\s*\(/.test(source)
    && !isFacade) {
    fail(`runtime worker authority is not allowed in the app layer: ${name}`);
  }
}

console.log('FxAeon architecture verified: SDK access is bounded and no app-layer worker authority is active.');
