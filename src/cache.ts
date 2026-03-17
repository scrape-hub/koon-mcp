interface CacheEntry {
  content: string;
  timestamp: number;
}

const TTL_MS = 15 * 60 * 1000; // 15 minutes
const cache = new Map<string, CacheEntry>();

export function cacheGet(key: string): string | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.content;
}

export function cacheSet(key: string, content: string): void {
  cache.set(key, { content, timestamp: Date.now() });
}

// Self-cleaning: purge expired entries every 5 minutes
// .unref() ensures this timer doesn't keep the process alive
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (now - entry.timestamp > TTL_MS) {
      cache.delete(key);
    }
  }
}, 5 * 60 * 1000).unref();
