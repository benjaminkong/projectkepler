// Walking distances from a parcel to nearby places, along footpaths and roads.
// Uses the public OSRM "foot" router run by FOSSGIS on OpenStreetMap data (no key needed;
// fair-use policy, so results are cached for a week and requested once per site).
// OneMap's routing API would also work but needs a OneMap account token.
// If routing is unavailable, callers fall back to straight-line distance.
import type { LatLng } from "./geo";

const ROUTER = "https://routing.openstreetmap.de/routed-foot/table/v1/foot";
const MAX_DESTINATIONS = 90; // keep URLs short and requests polite
const CACHE_SECONDS = 7 * 24 * 60 * 60;

/** Walking pace used for minutes (about 4.8 km/h). */
export const WALK_METRES_PER_MIN = 80;

const coord = (p: LatLng) => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`;

// The public router rate-limits bursts (HTTP 429), so requests go out one at a time with a gap,
// identical requests share one answer, and answers are kept in memory for a week.
const GAP_MS = 1100;
const RETRIES = 2;
type WalkState = { queue: Promise<unknown>; results: Map<string, { at: number; value: Promise<(number | null)[]> }> };
const gw = globalThis as typeof globalThis & { __walking?: WalkState };
const state: WalkState = (gw.__walking ??= { queue: Promise.resolve(), results: new Map() });

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Runs `task` after every earlier queued task, then waits GAP_MS before the next one. */
function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = state.queue.then(task);
  state.queue = run.catch(() => undefined).then(() => sleep(GAP_MS));
  return run;
}

async function fetchRow(url: string): Promise<(number | null)[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      headers: { "User-Agent": "TenderSitesPortal/0.1 (Singapore GLS site explorer)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (res.status === 429 && attempt < RETRIES) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    if (!res.ok) throw new Error(`router HTTP ${res.status}`);
    const json = (await res.json()) as { code: string; distances?: (number | null)[][] };
    if (json.code !== "Ok" || !json.distances) throw new Error(`router code ${json.code}`);
    // Row 0 is the origin; column 0 is the origin itself.
    return json.distances[0].slice(1).map((d) => (typeof d === "number" ? Math.round(d) : null));
  }
}

/** One routed request, shared and remembered; failures are not remembered. */
function routedRow(url: string, size: number): Promise<(number | null)[]> {
  const hit = state.results.get(url);
  if (hit && Date.now() - hit.at < CACHE_SECONDS * 1000) return hit.value;
  const value = enqueue(() => fetchRow(url)).catch((err) => {
    console.warn("[walking] routing unavailable, using straight-line distances:", (err as Error).message);
    state.results.delete(url);
    return Array<number | null>(size).fill(null);
  });
  state.results.set(url, { at: Date.now(), value });
  return value;
}

/**
 * Walking distance in metres from `origin` to each destination, in the same order.
 * `null` where no route was found or the router could not be reached.
 */
export async function walkingDistances(origin: LatLng, destinations: LatLng[]): Promise<(number | null)[]> {
  const chunks: Promise<(number | null)[]>[] = [];
  for (let i = 0; i < destinations.length; i += MAX_DESTINATIONS) {
    const chunk = destinations.slice(i, i + MAX_DESTINATIONS);
    const url = `${ROUTER}/${[origin, ...chunk].map(coord).join(";")}?sources=0&annotations=distance`;
    chunks.push(routedRow(url, chunk.length));
  }
  return (await Promise.all(chunks)).flat();
}

export function walkMinutes(metres: number): number {
  return Math.max(1, Math.round(metres / WALK_METRES_PER_MIN));
}
