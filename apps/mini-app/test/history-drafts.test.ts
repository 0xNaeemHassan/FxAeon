import assert from "node:assert/strict";
import { test } from "node:test";
import type { Address } from "viem";
import {
  cancelSignatureRequiredDraft,
  clearSignatureDraftsForTests,
  readSignatureRequiredDrafts,
  restoreSignatureRequiredDraft,
  restoreSignatureRequiredDraftFromSearch,
  removeSignatureRequiredDraft,
  saveSignatureRequiredDraft,
  signatureDraftIdFromSearch,
  signatureDraftResumePath,
} from "../src/lib/fx/drafts";

const WALLET = "0x1111111111111111111111111111111111111111" as Address;

test.beforeEach(() => clearSignatureDraftsForTests());
test.afterEach(() => clearSignatureDraftsForTests());

test("signature-required history drafts are scoped and contain no executable request", () => {
  const draft = saveSignatureRequiredDraft({
    walletAddress: WALLET,
    chainId: 1,
    operation: "increasePosition",
    actionKey: "increasePosition:1:1000:2x",
    resumePath: "/positions?market=ETH&position=1",
    formState: { market: "ETH", side: "long", amount: "0.01", leverage: "2", remember: false },
  });
  assert.equal(readSignatureRequiredDrafts(WALLET)[0]?.status, "signature-required");
  assert.deepEqual(readSignatureRequiredDrafts("0x2222222222222222222222222222222222222222"), []);
  assert.equal("data" in draft, false);
  assert.equal("nonce" in draft, false);
  assert.equal(draft.resumePath, "/positions?market=ETH&position=1");
  assert.deepEqual(draft.formState, { market: "ETH", side: "long", amount: "0.01", leverage: "2", remember: false });
  assert.deepEqual(restoreSignatureRequiredDraft(draft.id, {
    walletAddress: WALLET,
    chainId: 1,
    operation: "increasePosition",
    actionKey: "increasePosition:1:1000:2x",
  })?.formState, draft.formState);
  assert.equal(restoreSignatureRequiredDraft(draft.id, {
    walletAddress: "0x2222222222222222222222222222222222222222",
    chainId: 1,
    operation: "increasePosition",
    actionKey: "increasePosition:1:1000:2x",
  }), undefined);
  assert.match(signatureDraftResumePath(draft), /^\/positions\?market=ETH&position=1&fxDraft=/);
  const resumePath = signatureDraftResumePath(draft);
  assert.equal(signatureDraftIdFromSearch(new URL(resumePath, "https://fxaeon.local").search), draft.id);
  assert.deepEqual(restoreSignatureRequiredDraftFromSearch(new URL(resumePath, "https://fxaeon.local").search, {
    walletAddress: WALLET,
    chainId: 1,
    operation: "increasePosition",
    actionKey: "increasePosition:1:1000:2x",
  })?.draft.id, draft.id);
});

test("draft cancellation is terminal until a caller explicitly creates a fresh draft", () => {
  const draft = saveSignatureRequiredDraft({
    walletAddress: WALLET,
    chainId: 8453,
    operation: "buildBridgeTx",
    actionKey: "bridge:fxUSD:100",
    resumePath: "/move",
  });
  cancelSignatureRequiredDraft(draft.id);
  assert.equal(readSignatureRequiredDrafts(WALLET)[0]?.status, "cancelled");
  removeSignatureRequiredDraft(draft.id);
  assert.deepEqual(readSignatureRequiredDrafts(WALLET), []);
});

test("draft routes reject external URLs so history cannot become an open redirect", () => {
  assert.throws(() => saveSignatureRequiredDraft({
    walletAddress: WALLET,
    chainId: 1,
    operation: "increasePosition",
    actionKey: "position",
    resumePath: "https://example.com/sign",
  }), /same-origin path/);
});

test("cancelled drafts cannot be restored and unsafe form snapshots are rejected", () => {
  const draft = saveSignatureRequiredDraft({
    walletAddress: WALLET,
    chainId: 1,
    operation: "depositFxSave",
    actionKey: "earn:deposit",
    resumePath: "/earn",
    formState: { amount: "1.2" },
  });
  cancelSignatureRequiredDraft(draft.id);
  assert.equal(restoreSignatureRequiredDraft(draft.id, {
    walletAddress: WALLET,
    chainId: 1,
    operation: "depositFxSave",
    actionKey: "earn:deposit",
  }), undefined);
  assert.throws(() => saveSignatureRequiredDraft({
    walletAddress: WALLET,
    chainId: 1,
    operation: "depositFxSave",
    actionKey: "earn:deposit",
    resumePath: "/earn",
    formState: { calldata: "0x1234" },
  }), /form state is invalid/);
});
