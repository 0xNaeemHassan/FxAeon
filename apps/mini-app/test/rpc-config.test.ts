import assert from "node:assert/strict";
import test from "node:test";
import { assertAlchemyRpcUrl, assertLocalForkRpcUrl } from "../src/lib/fx/config";

test("accepts only the reviewed Alchemy host for each supported chain", () => {
  assert.equal(
    assertAlchemyRpcUrl("https://eth-mainnet.g.alchemy.com/v2/browser-key", 1),
    "https://eth-mainnet.g.alchemy.com/v2/browser-key",
  );
  assert.equal(
    assertAlchemyRpcUrl("https://base-mainnet.g.alchemy.com/v2/browser-key", 8453),
    "https://base-mainnet.g.alchemy.com/v2/browser-key",
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://base-mainnet.g.alchemy.com/v2/browser-key", 1),
    /reviewed Alchemy host/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://rpc.attacker.example/v2/browser-key", 8453),
    /reviewed Alchemy host/,
  );
});

test("rejects credential-bearing and non-v2 RPC URLs", () => {
  assert.throws(
    () => assertAlchemyRpcUrl("http://eth-mainnet.g.alchemy.com/v2/key", 1),
    /HTTPS/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://user:pass@eth-mainnet.g.alchemy.com/v2/key", 1),
    /cannot include credentials/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://eth-mainnet.g.alchemy.com/v2/key?redirect=1", 1),
    /cannot include credentials/,
  );
  assert.throws(
    () => assertAlchemyRpcUrl("https://eth-mainnet.g.alchemy.com/", 1),
    /\/v2 application endpoint/,
  );
});

test("local fork URLs are limited to credential-free localhost endpoints", () => {
  assert.equal(assertLocalForkRpcUrl("http://127.0.0.1:8547"), "http://127.0.0.1:8547");
  assert.equal(assertLocalForkRpcUrl("http://localhost:8547/"), "http://localhost:8547");
  assert.throws(() => assertLocalForkRpcUrl("https://rpc.example/v2/key"), /localhost/);
  assert.throws(() => assertLocalForkRpcUrl("http://127.0.0.1:8547/?key=secret"), /credentials/);
});
