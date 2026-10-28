// Everything the price estimate needs for one site: the baseline valuation plus the
// location facts (MRT, schools, malls) that the AI step weighs. Server-only.
import { CATEGORIES, type CategoryId } from "./categories";
import { nearestStationsByWalking, type NearbyStation } from "./mrtLines";
import { findAllNearby, shownDistance, withWalkingDistances } from "./nearby";
import { getTransactions } from "./transactions";
import type { TenderSite } from "./ura";
import { valueSite, type Valuation } from "./valuation";

export interface AmenitySummary {
  category: CategoryId;
  label: string;
  radiusM: number;
  count: number;
  /** distanceM is the walking distance when `walking`, else straight line. */
  nearest?: { name: string; distanceM: number; walking: boolean };
}

export interface SiteValuationInputs {
  site: Pick<TenderSite, "slug" | "name" | "developmentType" | "tenderCloseDate" | "facts">;
  valuation: Valuation | null;
  amenities: AmenitySummary[];
  stations: NearbyStation[];
  dataAsOf: string;
}

export async function buildSiteValuationInputs(site: TenderSite): Promise<SiteValuationInputs | null> {
  if (!site.center) return null;
  const { rows, loadedAt } = await getTransactions();
  const nearby = await withWalkingDistances(site.center, findAllNearby(site.center));
  return {
    site: {
      slug: site.slug,
      name: site.name,
      developmentType: site.developmentType,
      tenderCloseDate: site.tenderCloseDate,
      facts: site.facts,
    },
    valuation: valueSite(site.center, rows, {
      developmentType: `${site.developmentType} ${site.facts.developmentCode ?? ""}`,
      maxGfaSqm: site.facts.maxGfaSqm,
      gfaInfo: site.facts.gfaInfo,
    }),
    amenities: CATEGORIES.map((c) => {
      const r = nearby[c.id];
      const first = r.items[0];
      return {
        category: c.id,
        label: c.label,
        radiusM: r.radiusM,
        count: r.items.length,
        nearest: first
          ? { name: first.name, distanceM: Math.round(shownDistance(first)), walking: first.walkM !== undefined }
          : undefined,
      };
    }),
    stations: await nearestStationsByWalking(site.center, 3),
    dataAsOf: loadedAt,
  };
}
