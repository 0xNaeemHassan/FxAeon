import assert from 'node:assert/strict';
import test from 'node:test';
import { createDeferredQueryCacheNotification } from '../src/lib/deferredQueryCacheNotification';

test('defers synchronous query-cache notifications and ignores queued work after unsubscribe', async () => {
  let listener: (() => void) | null = null;
  let changes = 0;
  const notification = createDeferredQueryCacheNotification(() => { changes += 1; });
  const subscribe = (next: () => void) => {
    listener = next;
    return () => { listener = null; };
  };
  const unsubscribe = subscribe(notification.notify);

  // QueryCache invokes listeners synchronously, including when a route's
  // query observer is being registered by a different component's render.
  listener!();
  assert.equal(changes, 0, 'React store updates must not run on the cache notification stack');
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(changes, 1, 'an active store still observes the cache change on TanStack’s scheduled turn');

  listener!();
  notification.dispose();
  unsubscribe();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(changes, 1, 'a notification queued before unsubscription must not publish afterwards');
});
