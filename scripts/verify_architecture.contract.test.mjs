import assert from 'node:assert/strict';
import { test } from 'node:test';
import { hasDirectSdkImport } from './verify_architecture.mjs';

test('architecture import detector ignores documentation copy', () => {
  assert.equal(hasDirectSdkImport('<strong>@aladdindao/fx-sdk</strong>'), false);
  assert.equal(hasDirectSdkImport('const label = "@aladdindao/fx-sdk";'), false);
  assert.equal(hasDirectSdkImport('// import { tokens } from "@aladdindao/fx-sdk";'), false);
  assert.equal(hasDirectSdkImport("export const caption = '@aladdindao/fx-sdk';"), false);
});

test('architecture import detector catches direct module declarations', () => {
  assert.equal(hasDirectSdkImport("import { tokens } from '@aladdindao/fx-sdk';"), true);
  assert.equal(hasDirectSdkImport("import type { FxSdk } from '@aladdindao/fx-sdk';"), true);
  assert.equal(hasDirectSdkImport("export { tokens } from '@aladdindao/fx-sdk';"), true);
  assert.equal(hasDirectSdkImport("const sdk = require('@aladdindao/fx-sdk');"), true);
  assert.equal(hasDirectSdkImport("const sdk = await import('@aladdindao/fx-sdk');"), true);
  assert.equal(hasDirectSdkImport("type FxSdk = import('@aladdindao/fx-sdk').FxSdk;"), true);
});
