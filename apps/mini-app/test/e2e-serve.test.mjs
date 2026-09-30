import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createExportManifest,
  createStaticServer,
  normalizeRequestPath,
} from '../e2e/serve.mjs';

function request(port, path) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        headers: res.headers,
        body: Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('static export server only resolves manifest routes and preserves clean URL behavior', async () => {
  const distRoot = await mkdtemp(join(tmpdir(), 'fxaeon-e2e-serve-'));
  const assetDir = join(distRoot, '_next', 'static');
  const nestedDir = join(distRoot, 'nested');
  await mkdir(assetDir, { recursive: true });
  await mkdir(nestedDir, { recursive: true });
  await writeFile(join(distRoot, 'index.html'), '<h1>home</h1>');
  await writeFile(join(distRoot, 'trade.html'), '<h1>trade</h1>');
  await writeFile(join(distRoot, '404.html'), '<h1>not found</h1>');
  await writeFile(join(nestedDir, 'index.html'), '<h1>nested</h1>');
  await writeFile(join(assetDir, 'app.js'), 'window.ready = true;');

  const manifest = await createExportManifest(distRoot);
  const server = createStaticServer(manifest);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  try {
    assert.equal(normalizeRequestPath('/trade?source=test'), '/trade');
    assert.equal(normalizeRequestPath('/%2e%2e/secret'), null);
    assert.equal(normalizeRequestPath('/%2e%2e%2fsecret'), null);
    assert.equal(normalizeRequestPath('/%5c..%5csecret'), null);
    assert.equal(normalizeRequestPath('/%E0%A4%A'), null);

    const home = await request(port, '/');
    assert.equal(home.status, 200);
    assert.equal(home.body, '<h1>home</h1>');
    assert.equal(home.headers['cache-control'], 'no-store');

    const trade = await request(port, '/trade?source=test');
    assert.equal(trade.status, 200);
    assert.equal(trade.body, '<h1>trade</h1>');
    assert.match(trade.headers['content-type'], /text\/html/);

    const tradeWithTrailingSlash = await request(port, '/trade/');
    assert.equal(tradeWithTrailingSlash.status, 200);
    assert.equal(tradeWithTrailingSlash.body, '<h1>trade</h1>');

    const nested = await request(port, '/nested/');
    assert.equal(nested.status, 200);
    assert.equal(nested.body, '<h1>nested</h1>');

    const asset = await request(port, '/_next/static/app.js');
    assert.equal(asset.status, 200);
    assert.match(asset.headers['content-type'], /javascript/);
    assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');

    for (const path of ['/%2e%2e/secret', '/%2e%2e%2fsecret', '/%5c..%5csecret']) {
      const traversal = await request(port, path);
      assert.equal(traversal.status, 404, path);
      assert.equal(traversal.body, '<h1>not found</h1>', path);
    }

    const missing = await request(port, '/no-such-route');
    assert.equal(missing.status, 404);
    assert.equal(missing.body, '<h1>not found</h1>');
  } finally {
    server.close();
    await once(server, 'close');
    await rm(distRoot, { recursive: true, force: true });
  }
});
