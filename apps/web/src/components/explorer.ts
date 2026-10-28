import type { CategoryId } from "@tender/core/categories";
import type { LatLng } from "@tender/core/geo";

export interface ExplorerSite {
  slug: string;
  name: string;
  center: LatLng;
  parcel?: number[][][][];
}

/** `n` changes on every click, so clicking the same place again flies back to it. */
export type FocusTarget = { category: CategoryId; index: number; n: number } | null;

/** Identifies one place on the map, e.g. "mrt:0" for the nearest MRT station. */
export const placeKey = (category: CategoryId, index: number) => `${category}:${index}`;
