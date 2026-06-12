/**
 * Admin error alerts: scrubbing, dedupe, fail-soft behaviour, error IDs,
 * and the DB error classifier that powers the deep-health databaseHint.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  initAdminAlerts,
  resetAdminAlerts,
  reportErrorToAdmin,
  scrubSensitive,
  newErrorId,
} from "../src/observability/admin-alerts";
import { classifyDbError } from "../src/api/health";

describe("scrubSensitive", () => {
  it("strips credentials from connection strings", () => {
    const out = scrubSensitive("postgresql://postgres:Sup3rS3cret@db.host:5432/postgres failed");
    expect(out).not.toContain("Sup3rS3cret");
    expect(out).toContain("postgresql://***@db.host:5432/postgres");
  });

  it("strips redis URLs too", () => {
    const out = scrubSensitive("rediss://default:tokenvalue123@host.upstash.io:6379 ECONNRESET");
    expect(out).not.toContain("tokenvalue123");
  });

  it("masks api keys and tokens in key=value form", () => {
    // Fixture values are obviously fake; this test PROVES they get scrubbed.
    const fakeKey = ["abcdef", "123456789"].join("");
    const fakeToken = ["zyxwvu", "987654321"].join("");
    const out = scrubSensitive(`api_key=${fakeKey} rejected; token: ${fakeToken}`);
    expect(out).not.toContain(fakeKey);
    expect(out).not.toContain(fakeToken);
  });

  it("truncates long hex blobs (keys/signatures) but keeps a prefix", () => {
    const blob = "0x" + "ab".repeat(32);
    const out = scrubSensitive(`sig ${blob} invalid`);
    expect(out).not.toContain(blob);
    expect(out).toContain("0xabab");
  });
});

describe("newErrorId", () => {
  it("generates distinct, short, prefixed IDs", () => {
    const a = newErrorId();
    const b = newErrorId();
    expect(a).toMatch(/^E-[A-Z0-9]+$/);
    expect(a).not.toBe(b);
  });
});

describe("reportErrorToAdmin", () => {
  beforeEach(() => resetAdminAlerts());

  it("sends a scrubbed alert with source, message and stack", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    initAdminAlerts(send, "12345");
    const id = reportErrorToAdmin(new Error("connect failed at postgresql://u:pw@h:5432/db"), {
      source: "startCommand",
      command: "start",
      telegramId: "999",
    });
    expect(send).toHaveBeenCalledTimes(1);
    const [chatId, message] = send.mock.calls[0];
    expect(chatId).toBe("12345");
    expect(message).toContain(id);
    expect(message).toContain("startCommand");
    expect(message).toContain("user: 999");
    expect(message).not.toContain("u:pw");
  });

  it("dedupes identical signatures within the window but still returns IDs", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    initAdminAlerts(send, "12345");
    const id1 = reportErrorToAdmin(new Error("same boom"), { source: "x" });
    const id2 = reportErrorToAdmin(new Error("same boom"), { source: "x" });
    expect(send).toHaveBeenCalledTimes(1);
    expect(id1).not.toBe(id2);
  });

  it("different errors are not deduped", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    initAdminAlerts(send, "12345");
    reportErrorToAdmin(new Error("boom A"), { source: "x" });
    reportErrorToAdmin(new Error("boom B"), { source: "x" });
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("is a no-op (but still returns an ID) when not initialized", () => {
    const id = reportErrorToAdmin(new Error("boom"), { source: "x" });
    expect(id).toMatch(/^E-/);
  });

  it("never throws when the send function rejects", () => {
    initAdminAlerts(() => Promise.reject(new Error("telegram down")), "12345");
    expect(() => reportErrorToAdmin(new Error("boom"), { source: "x" })).not.toThrow();
  });

  it("handles non-Error throwables", () => {
    const send = vi.fn().mockResolvedValue(undefined);
    initAdminAlerts(send, "12345");
    reportErrorToAdmin("string failure", { source: "x" });
    expect(send.mock.calls[0][1]).toContain("string failure");
  });
});

describe("classifyDbError", () => {
  it("identifies missing schema (P2021 / relation does not exist)", () => {
    expect(classifyDbError({ code: "P2021", message: "table does not exist" })).toContain("schema-missing");
    expect(
      classifyDbError(new Error('relation "User" does not exist'))
    ).toContain("schema-missing");
  });

  it("identifies pgbouncer prepared-statement failures", () => {
    expect(
      classifyDbError(new Error('prepared statement "s0" already exists'))
    ).toContain("pgbouncer");
  });

  it("identifies auth failures", () => {
    expect(classifyDbError({ code: "P1000", message: "auth" })).toContain("auth-failed");
    expect(classifyDbError(new Error("password authentication failed for user"))).toContain(
      "auth-failed"
    );
  });

  it("identifies unreachable hosts", () => {
    expect(classifyDbError({ code: "P1001", message: "down" })).toContain("unreachable");
  });

  it("identifies timeouts", () => {
    expect(classifyDbError(new Error("db health check timed out"))).toContain("timeout");
  });

  it("falls back to a truncated unknown without inventing causes", () => {
    const hint = classifyDbError(new Error("weird driver thing"));
    expect(hint).toContain("unknown");
    expect(hint).toContain("weird driver thing");
  });
});
