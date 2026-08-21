import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function rootFile(name: string): string {
  return readFileSync(
    fileURLToPath(new URL(`../../../${name}`, import.meta.url)),
    "utf8"
  );
}

describe("production routing and runtime configuration", () => {
  it("routes only the exact Telegram webhook path to bot port 8080", () => {
    const nginx = rootFile("nginx.conf");
    expect(nginx).toMatch(/upstream bot\s*\{\s*server bot:8080;/);
    expect(nginx).toContain("location = /webhook {");
    expect(nginx).not.toMatch(/location\s+\/webhook\//);
  });

  it("uses process liveness rather than dependency readiness for Docker", () => {
    const compose = rootFile("docker-compose.yml");
    const dockerfile = rootFile("apps/bot/Dockerfile");
    expect(compose).toContain("http://localhost:8080/health");
    expect(compose).not.toContain(
      '"http://localhost:8080/api/v1/health"'
    );
    expect(compose).toContain("REDIS_URL: ${DOCKER_REDIS_URL:-redis://redis:6379}");
    expect(dockerfile).toContain("EXPOSE 8080");
  });

  it("keeps the canonical RPC setting and removes stale Render variables", () => {
    const render = rootFile("render.yaml");
    expect(render).toContain("key: ALCHEMY_RPC_URL");
    expect(render).not.toContain("SURPLUS_API_KEY");
    expect(render).not.toContain("KMS_MASTER_KEY");
  });

  it("adds restart-safe watcher state through a nullable migration", () => {
    const migration = rootFile(
      "packages/db/prisma/migrations/20260813_deposit_watcher_cursor_baseline/migration.sql"
    );
    expect(migration).toContain('ADD COLUMN "lastCheckedBlock" BIGINT');
    expect(migration).toContain('ADD COLUMN "ethBalanceBaselineWei" BIGINT');
    expect(migration).not.toMatch(/ADD COLUMN[^;]+NOT NULL/s);
    expect(migration).toContain('WHERE "fromBlock" > 0');
  });

  it("does not embed project endpoints or curl a Redis TCP URL", () => {
    const healthCheck = rootFile("health-check.sh");
    expect(healthCheck).not.toMatch(/fxbot-mini-app\.pages\.dev/i);
    expect(healthCheck).not.toMatch(/supabase\.co/i);
    expect(healthCheck).not.toMatch(/cmq6a73jc002k0cl5vgleejt2/i);
    expect(healthCheck).toContain('redis-cli --no-auth-warning -u "$REDIS_URL" ping');
    expect(healthCheck).toContain("UPSTASH_REDIS_REST_URL");
  });

  it("wires the deposit watcher into the main worker startup", () => {
    const main = readFileSync(
      fileURLToPath(new URL("../src/main.ts", import.meta.url)),
      "utf8"
    );
    expect(main).toContain("startDepositWatcherPoller(async");
  });
});
