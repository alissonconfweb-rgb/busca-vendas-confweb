const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class MemoryRateLimiter {
  constructor() {
    this.buckets = new Map();
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  consume(key, { limit, windowMs }) {
    const now = Date.now();
    const normalizedLimit = Math.max(1, Number(limit) || 1);
    const normalizedWindow = Math.max(1_000, Number(windowMs) || 60_000);
    let bucket = this.buckets.get(key);

    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + normalizedWindow };
      this.buckets.set(key, bucket);
    }

    bucket.count += 1;
    const allowed = bucket.count <= normalizedLimit;
    return {
      allowed,
      limit: normalizedLimit,
      remaining: Math.max(0, normalizedLimit - bucket.count),
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1_000)),
      resetAt: bucket.resetAt,
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}

export function applyRateLimit({ limiter, req, res, scope, identity, limit, windowMs }) {
  const result = limiter.consume(`${scope}:${identity}`, { limit, windowMs });
  res.setHeader("RateLimit-Limit", String(result.limit));
  res.setHeader("RateLimit-Remaining", String(result.remaining));
  res.setHeader("RateLimit-Reset", String(Math.ceil(result.resetAt / 1_000)));
  if (result.allowed) {
    return true;
  }

  res.setHeader("Retry-After", String(result.retryAfterSeconds));
  res.writeHead(429, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({
    error: "Muitas tentativas em pouco tempo. Aguarde alguns instantes e tente novamente.",
    code: "RATE_LIMITED",
    retryAfterSeconds: result.retryAfterSeconds,
  }));
  return false;
}
