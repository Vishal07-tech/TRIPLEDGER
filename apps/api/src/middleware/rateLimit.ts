import type { NextFunction, Request, Response } from 'express';

type RateLimitOptions = {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests allowed per key inside one window. */
  max: number;
  /** Bucket name so separate routes do not share counters. */
  keyPrefix: string;
  message?: string;
  /** Bound the in-memory map so a hostile client cannot grow it without limit. */
  maxKeys?: number;
};

const MAX_TRACKED_KEYS = 10_000;

/**
 * Small fixed-window limiter. Enough to make trip-code and password guessing
 * impractical on a single-instance API without adding a dependency or
 * requiring shared storage. Swap for a Redis-backed limiter if the API is ever
 * horizontally scaled.
 */
export function createRateLimiter({
  windowMs,
  max,
  keyPrefix,
  message = 'Too many requests. Please wait and try again.',
  maxKeys = MAX_TRACKED_KEYS,
}: RateLimitOptions) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  function sweep(now: number) {
    for (const [key, entry] of hits) {
      if (entry.resetAt <= now) hits.delete(key);
    }
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction) {
    const now = Date.now();
    const key = `${keyPrefix}:${req.ip ?? 'unknown'}`;
    let entry = hits.get(key);

    if (!entry || entry.resetAt <= now) {
      if (hits.size >= maxKeys) sweep(now);
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }

    entry.count += 1;

    if (entry.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      res.status(429).json({ message });
      return;
    }

    next();
  };
}
