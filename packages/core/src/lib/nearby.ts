import { CATEGORIES, type CategoryId } from "./categories";
import { DATASETS, type Poi } from "./datasets";
import { formatDistance, haversineMeters, type LatLng } from "./geo";
import { walkingDistances, walkMinutes } from "./walking";

export const PRIMARY_RADIUS_M = 1000;
export const FALLBACK_RADIUS_M = 2000;

export interface NearbyPoi extends Poi {
  /** Straight-line distance; decides which radius a place falls in. */
  distanceM: number;
  /** Walking distance along paths, when the router found a route. */
  walkM?: number;
}

/** "650 m walk · 8 min", or "650 m (straight line)" when no walking route is known. */
export function describeDistance(p: { distanceM: number; walkM?: number }): string {
  return p.walkM !== undefined
    ? `${formatDistance(p.walkM)} walk · ${walkMinutes(p.walkM)} min`
    : `${formatDistance(p.distanceM)} (straight line)`;
}

/** Compact form for lists: "650 m walk" or "650 m direct". */
export function shortDistance(p: { distanceM: number; walkM?: number }): string {
  return p.walkM !== undefined ? `${formatDistance(p.walkM)} walk` : `${formatDistance(p.distanceM)} direct`;
}

/** The distance to show and sort by: walking when known, else straight line. */
export const shownDistance = (p: { distanceM: number; walkM?: number }) => p.walkM ?? p.distanceM;

export interface NearbyResult {
  /** Radius actually used: 1 km, or 2 km when nothing was found within 1 km. */
  radiusM: number;
  widened: boolean;
  items: NearbyPoi[];
}

/**
 * Radius rule (FR-2.5): search 1 km. Only when `widen` is set (primary schools)
 * and nothing is within 1 km, search 2 km instead.
 */
export function findNearby(center: LatLng, pois: Poi[], widen = false): NearbyResult {
  const withDistance = pois
    .map((p) => ({ ...p, distanceM: haversineMeters(center, p) }))
    .filter((p) => p.distanceM <= FALLBACK_RADIUS_M)
    .sort((a, b) => a.distanceM - b.distanceM);

  const within1km = withDistance.filter((p) => p.distanceM <= PRIMARY_RADIUS_M);
  if (within1km.length > 0 || !widen) {
    return { radiusM: PRIMARY_RADIUS_M, widened: false, items: within1km };
  }
  return { radiusM: FALLBACK_RADIUS_M, widened: true, items: withDistance };
}

export function findAllNearby(
  center: LatLng,
  datasets: Record<CategoryId, Poi[]> = DATASETS,
): Record<CategoryId, NearbyResult> {
  return Object.fromEntries(
    CATEGORIES.map((c) => [c.id, findNearby(center, datasets[c.id], c.widenTo2km)]),
  ) as Record<CategoryId, NearbyResult>;
}

/**
 * Adds walking distances to every place in the results (one routing request per site)
 * and re-sorts each category by them. Places keep their straight-line distance too.
 */
export async function withWalkingDistances(
  center: LatLng,
  results: Record<CategoryId, NearbyResult>,
): Promise<Record<CategoryId, NearbyResult>> {
  // Primary schools keep straight-line distance: MOE's Primary 1 priority (within 1 km / 2 km)
  // is measured as the crow flies, so that is the figure buyers care about.
  const all = CATEGORIES.filter((c) => !c.straightLine).flatMap((c) => results[c.id].items);
  const walks = await walkingDistances(center, all);
  const byPoi = new Map(all.map((p, i) => [p, walks[i]]));
  return Object.fromEntries(
    CATEGORIES.map((c) => {
      const r = results[c.id];
      const items = r.items
        .map((p) => ({ ...p, walkM: byPoi.get(p) ?? undefined }))
        .sort((a, b) => shownDistance(a) - shownDistance(b));
      return [c.id, { ...r, items }];
    }),
  ) as Record<CategoryId, NearbyResult>;
}
