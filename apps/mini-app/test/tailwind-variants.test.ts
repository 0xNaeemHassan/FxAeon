import assert from 'node:assert/strict';
import { test } from 'node:test';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';
import tailwindConfig from '../tailwind.config.js';

// Tailwind silently drops any candidate whose selector fails to serialize, so a
// dependency regression shows up only as missing CSS. postcss-selector-parser
// 6.1.3 did that to every :merge()-based (group-*/peer-*) variant.
test('tailwind emits group-* and peer-* variant rules', async () => {
  const raw = 'group-open:rotate-180 group-open:hidden group-hover:underline peer-checked:underline';
  const { css } = await postcss([tailwindcss({ ...tailwindConfig, content: [{ raw, extension: 'html' }] })])
    .process('@tailwind utilities;', { from: undefined });

  for (const selector of [
    '.group[open] .group-open\\:rotate-180',
    '.group[open] .group-open\\:hidden',
    '.group:hover .group-hover\\:underline',
    '.peer:checked ~ .peer-checked\\:underline',
  ]) {
    assert.ok(css.includes(selector), `missing ${selector}`);
  }
});
