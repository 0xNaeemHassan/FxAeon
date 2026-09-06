import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const HERE = dirname(fileURLToPath(import.meta.url));
const BORROW_PAGE = join(HERE, '..', 'src', 'app', 'borrow', 'page.tsx');

test('Borrow consumes the provider snapshot instead of starting a duplicate position discovery read', () => {
  const source = readFileSync(BORROW_PAGE, 'utf8');

  assert.match(source, /const sharedPositions = useProtocolPositions\(\);/);
  assert.match(source, /sharedPositions\.positions\.filter\(\(position\) => position\.side === 'long'\)/);
  assert.match(source, /const refreshPositions = sharedPositions\.refresh;/);
  assert.doesNotMatch(source, /\breadAllPositions\b/);
});

test('Borrow blocks reviews for retained positions whose verification group is stale', () => {
  const source = readFileSync(BORROW_PAGE, 'utf8');

  assert.match(source, /const selectedStale = selected \? positionIsStale\(selected, sharedPositions\.failedGroups\) : false;/);
  assert.match(source, /if \(selectedStale\) return null;/);
});
