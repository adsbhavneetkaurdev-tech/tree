import "server-only";

/**
 * Small in-memory sliding-window limiter. Good enough for a single event
 * venue; on serverless each instance keeps its own window, which still
 * blunts accidental double-taps and casual spam.
 */
const g = globalThis as unknown as { __wishTreeHits?: Map<string, number[]> };
const hits = (g.__wishTreeHits ??= new Map());

export function rateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t: number) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t: number) => now - t >= windowMs)) hits.delete(k);
  }
  return true;
}

export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  return (fwd?.split(",")[0] || req.headers.get("x-real-ip") || "unknown").trim();
}
