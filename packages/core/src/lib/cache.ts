// In-memory cache with stale-while-revalidate, standing in for Next.js's fetch cache.
// A fresh value is served as is; a stale one is served while a refresh runs in the background
// (if the refresh fails, the stale value stays). Failures are never cached.
// Per process: each container instance keeps its own copy until a shared store replaces it.

type Entry = { at: number; value?: unknown; pending?: Promise<unknown> };
const g = globalThis as typeof globalThis & { __cache?: Map<string, Entry> };
const entries: Map<string, Entry> = (g.__cache ??= new Map());

export async function cached<T>(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
  const entry = entries.get(key);
  const refresh = () => {
    const pending = load()
      .then((value) => {
        entries.set(key, { at: Date.now(), value });
        return value;
      })
      .finally(() => {
        const e = entries.get(key);
        if (e?.pending === pending) delete e.pending;
      });
    entries.set(key, { ...(entries.get(key) ?? { at: 0 }), pending });
    return pending;
  };

  if (entry && "value" in entry) {
    if (Date.now() - entry.at >= ttlMs && !entry.pending) {
      refresh().catch((err) => console.warn(`[cache] refresh of ${key} failed, serving stale:`, (err as Error).message));
    }
    return entry.value as T;
  }
  if (entry?.pending) return entry.pending as Promise<T>;
  return refresh().catch((err) => {
    entries.delete(key);
    throw err;
  });
}

/** For tests. */
export function clearCache() {
  entries.clear();
}
