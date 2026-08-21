import { vi } from "vitest";

// Mock @fxaeon/db — prisma returns null user by default (new user flow)
vi.mock("@fxaeon/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({ id: "test-id", telegramId: "123456" }),
      update: vi.fn().mockResolvedValue({}),
    },
    position: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    deletedUser: {
      findUnique: vi.fn().mockResolvedValue(null),
    },
    automationRule: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    positionSnapshot: {
      findMany: vi.fn().mockResolvedValue([]),
      create: vi.fn().mockResolvedValue({}),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    limitOrder: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
    priceAlert: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
      count: vi.fn().mockResolvedValue(0),
      create: vi.fn().mockResolvedValue({}),
      update: vi.fn().mockResolvedValue({}),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

// W-17: trade intents are HMAC-signed; give tests a deterministic secret so
// preview/confirm paths can sign without a real bot token.
// Keep the shared fixture inside the same minimum-strength boundary as the
// production config. A deliberately under-sized key makes any request path
// that calls getConfig() fail asynchronously and can hide the behavior the
// test intended to exercise.
process.env.INTENT_SECRET ??= "test-intent-secret-at-least-32-bytes";
