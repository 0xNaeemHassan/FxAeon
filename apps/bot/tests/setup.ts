import { vi } from "vitest";

// Mock @fxbot/db — prisma returns null user by default (new user flow)
vi.mock("@fxbot/db", () => ({
  prisma: {
    user: {
      findUnique: vi.fn().mockResolvedValue(null),
      create: vi.fn().mockResolvedValue({ id: "test-id", telegramId: "123456" }),
      update: vi.fn().mockResolvedValue({}),
    },
    position: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
    automationRule: {
      findMany: vi.fn().mockResolvedValue([]),
      findUnique: vi.fn().mockResolvedValue(null),
    },
    limitOrder: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    auditLog: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}));
