import assert from 'node:assert/strict';
import test from 'node:test';
import { findCloudflareRuleForHeader } from './cloudflare_headers.mjs';

test('finds a global selector across earlier header values in the same rule block', () => {
  const lines = [
    '/*',
    '  Strict-Transport-Security: max-age=31536000',
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Content-Security-Policy: frame-ancestors https://web.telegram.org',
    '',
    '/_next/static/*',
    '  Cache-Control: public, max-age=31536000, immutable',
  ];
  assert.equal(findCloudflareRuleForHeader(lines, 4), '/*');
});

test('does not mistake a route-specific selector for the global CSP rule', () => {
  const lines = [
    '/*',
    '  X-Content-Type-Options: nosniff',
    '/positions',
    '  Referrer-Policy: no-referrer',
    '  Content-Security-Policy: frame-ancestors https://web.telegram.org',
  ];
  assert.equal(findCloudflareRuleForHeader(lines, 4), '/positions');
  assert.notEqual(findCloudflareRuleForHeader(lines, 4), '/*');
});
