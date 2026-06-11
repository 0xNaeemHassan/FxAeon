import { logger } from "../middleware/logger.js";

/**
 * Returns REDIS_URL only when it is a TCP redis URL that ioredis can dial.
 *
 * Upstash shows two connection strings: a REST endpoint (`https://...`, used
 * with a bearer token by the smoke test) and a TCP endpoint
 * (`rediss://default:<password>@<host>:6379`, what the bot needs). Pasting
 * the REST URL into REDIS_URL used to make ioredis dial an HTTPS host as if
 * it spoke RESP and hang/retry forever — taking the rate limiter (and with
 * it the Telegram webhook) down. Treat such values as "no Redis" instead,
 * with a loud log so the operator can fix the env var.
 */
let warned = false;

export function getRedisUrl(): string | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  if (/^rediss?:\/\//i.test(url)) return url;
  if (!warned) {
    warned = true;
    logger.error(
      { redisUrlScheme: url.split(":")[0] },
      "REDIS_URL is not a redis:// or rediss:// URL (looks like an Upstash REST endpoint?). " +
        "ioredis needs the TCP connection string — rediss://default:<password>@<host>:6379. " +
        "Continuing WITHOUT Redis: in-memory rate limits, tx cap enforced at DB level."
    );
  }
  return undefined;
}
