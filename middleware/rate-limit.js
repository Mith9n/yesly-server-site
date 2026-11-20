/**
 * Small in-memory fixed-window rate limiter. Enough to stop credential
 * stuffing, sign-up spam and anonymous upload abuse on a single API node.
 * For a horizontally scaled deployment, swap the Map for Redis.
 */
const buckets = new Map();
let lastSweep = Date.now();

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function sweep(now) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit({
  windowMs = 60_000,
  max = 60,
  name = "default",
  message = "Too many requests. Please wait a moment and try again.",
} = {}) {
  return (req, res, next) => {
    const now = Date.now();
    sweep(now);

    const key = `${name}:${clientIp(req)}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    const remaining = Math.max(0, max - bucket.count);
    res.setHeader("RateLimit-Limit", String(max));
    res.setHeader("RateLimit-Remaining", String(remaining));
    res.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));

    if (bucket.count > max) {
      res.setHeader("Retry-After", String(Math.ceil((bucket.resetAt - now) / 1000)));
      const error = new Error(message);
      error.status = 429;
      return next(error);
    }

    return next();
  };
}
