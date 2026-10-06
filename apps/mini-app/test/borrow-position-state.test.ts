import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { borrowSelectionIsActionable } from '../src/app/borrow/selectionEligibility';

const HERE = dirname(fileURLToPath(import.meta.url));
const BORROW_PAGE = join(HERE, '..', 'src', 'app', 'borrow', 'page.tsx');

test('Borrow consumes the provider snapshot instead of starting a duplicate position discovery read', () => {
  const source = readFileSync(BORROW_PAGE, 'utf8');

  assert.match(source, /const sharedPositions = useProtocolPositions\(\);/);
  assert.match(source, /sharedPositions\.positions\.filter\(\(position\) => position\.side === 'long'\)/);
  assert.match(source, /const refreshPositions = sharedPositions\.refresh;/);
  assert.doesNotMatch(source, /\breadAllPositions\b/);
});

test('Borrow does not build or sign a reviewed route after a selected position becomes stale', () => {
  const source = readFileSync(BORROW_PAGE, 'utf8');

  assert.match(source, /const selectedStale = selected \? positionIsStale\(selected, sharedPositions\.failedGroups\) : false;/);
  assert.match(source, /if \(!selectedActionable\) return null;/);

  const accountA = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const accountB = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const base = {
    walletAddress: accountA,
    snapshotWalletAddress: accountA,
    selectedKey: 'ETH:long:17',
    hasSelectedPosition: true,
  };
  let reviewRequests = 0;
  let signingRequests = 0;
  const attemptReview = (selectedStale: boolean) => {
    if (!borrowSelectionIsActionable({ ...base, selectedStale })) return;
    reviewRequests += 1;
    signingRequests += 1;
  };

  // The verified selection can first reach review. Once its pool verification
  // fails, the retained display row cannot create another review or signature.
  attemptReview(false);
  assert.equal(reviewRequests, 1);
  attemptReview(true);
  assert.equal(reviewRequests, 1);
  assert.equal(signingRequests, 1);

  // A newly connected account cannot act on a snapshot still owned by A.
  assert.equal(borrowSelectionIsActionable({
    ...base,
    walletAddress: accountB,
    selectedStale: false,
  }), false);
});
