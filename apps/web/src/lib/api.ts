import type { NearbyStation } from "@tender/core/mrtLines";
import type { NearbyResult } from "@tender/core/nearby";
import type { CategoryId } from "@tender/core/categories";
import type { TenderSite } from "@tender/core/ura";

export class ApiError extends Error {
  constructor(public status: number, message: string, public body?: unknown) {
    super(message);
  }
}

/** GETs or POSTs JSON from the Fastify API; non-2xx responses throw ApiError with the server's message. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const body = await res.json().catch(() => undefined);
  if (!res.ok) {
    const msg = (body as { error?: string; message?: string } | undefined);
    throw new ApiError(res.status, msg?.error ?? msg?.message ?? res.statusText, body);
  }
  return body as T;
}

export type SiteWithNearby = TenderSite & { nearby: { mrt: NearbyResult; primary_school: NearbyResult } | null };
export interface SitesResponse {
  sites: SiteWithNearby[];
  uraLastUpdated?: string;
  fetchedAt: string;
}
export interface SiteResponse {
  site: TenderSite;
  nearby: Record<CategoryId, NearbyResult> | null;
}
export interface SiteMrtResponse {
  site: { slug: string; name: string };
  nearby: NearbyStation[];
}
