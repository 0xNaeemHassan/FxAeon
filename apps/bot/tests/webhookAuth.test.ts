import { describe, it, expect } from "vitest";
import crypto from "node:crypto";
import { verifySvixSignature } from "../src/utils/webhookAuth.js";

const SECRET_RAW = Buffer.from("test-secret-key-for-svix-webhooks", "utf8");
const SECRET = "whsec_" + SECRET_RAW.toString("base64");

function sign(id: string, ts: number, body: string, key: Buffer = SECRET_RAW): string {
  const mac = crypto.createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
  return `v1,${mac}`;
}

describe("verifySvixSignature", () => {
  const body = JSON.stringify({ type: "transaction.confirmed", hash: "0xabc" });
  const now = 1_750_000_000;

  it("accepts a valid signature", () => {
    const sig = sign("msg_1", now, body);
    const r = verifySvixSignature(body, { id: "msg_1", timestamp: String(now), signature: sig }, SECRET, now);
    expect(r.ok).toBe(true);
  });

  it("accepts when one of multiple signatures matches", () => {
    const good = sign("msg_1", now, body);
    const bad = "v1," + crypto.randomBytes(32).toString("base64");
    const r = verifySvixSignature(body, { id: "msg_1", timestamp: String(now), signature: `${bad} ${good}` }, SECRET, now);
    expect(r.ok).toBe(true);
  });

  it("rejects a tampered body", () => {
    const sig = sign("msg_1", now, body);
    const r = verifySvixSignature(body.replace("0xabc", "0xdef"), { id: "msg_1", timestamp: String(now), signature: sig }, SECRET, now);
    expect(r.ok).toBe(false);
  });

  it("rejects a wrong key", () => {
    const sig = sign("msg_1", now, body, Buffer.from("other-key"));
    const r = verifySvixSignature(body, { id: "msg_1", timestamp: String(now), signature: sig }, SECRET, now);
    expect(r.ok).toBe(false);
  });

  it("rejects stale timestamps (replay window)", () => {
    const old = now - 6 * 60; // > 5 min skew
    const sig = sign("msg_1", old, body);
    const r = verifySvixSignature(body, { id: "msg_1", timestamp: String(old), signature: sig }, SECRET, now);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("timestamp");
  });

  it("rejects missing headers", () => {
    const r = verifySvixSignature(body, { id: undefined, timestamp: String(now), signature: "v1,x" }, SECRET, now);
    expect(r.ok).toBe(false);
  });

  it("rejects when secret is empty", () => {
    const sig = sign("msg_1", now, body);
    const r = verifySvixSignature(body, { id: "msg_1", timestamp: String(now), signature: sig }, "whsec_", now);
    expect(r.ok).toBe(false);
  });
});
