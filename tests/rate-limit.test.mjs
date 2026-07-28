import assert from "node:assert/strict";
import test from "node:test";
import { MemoryRateLimiter } from "../server/rate-limit.mjs";

test("bloqueia somente depois de atingir o limite", () => {
  const limiter = new MemoryRateLimiter();
  assert.equal(limiter.consume("login:ip", { limit: 2, windowMs: 60_000 }).allowed, true);
  assert.equal(limiter.consume("login:ip", { limit: 2, windowMs: 60_000 }).allowed, true);
  const blocked = limiter.consume("login:ip", { limit: 2, windowMs: 60_000 });
  assert.equal(blocked.allowed, false);
  assert.ok(blocked.retryAfterSeconds > 0);
});
