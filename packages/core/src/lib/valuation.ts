// Indicative land price for a tender site, in two steps:
//  1. Comparables: private home transactions near the parcel give an expected launch price ($psf).
//  2. Residual land value: launch revenue minus development costs and profit, per sqft of GFA,
//     gives what a developer could pay for the land ($psf ppr = per square foot per plot ratio).
// This is a transparent baseline, not a valuation. The AI step (aiValuation.ts) reviews and adjusts it.
import { haversineMeters, type LatLng } from "./geo";
import type { Transaction } from "./transactions";

export const SQM_TO_SQFT = 10.7639;

/** Model assumptions. Tune these with your feasibility team. */
export const ASSUMPTIONS = {
  lookbackMonths: 24,
  radiusM: 1000,
  /** Widen to this radius when fewer than `minComparables` transactions are found. */
  fallbackRadiusM: 2000,
  minComparables: 30,
  /** New sales needed before we trust them for the launch price; otherwise resale + premium. */
  minNewSales: 10,
  /** Typical new-launch premium over nearby resale. */
  newLaunchPremium: 0.2,
  /** Saleable area per sqft of GFA. */
  saleableToGfa: 1.0,
  /** Construction cost per sqft of GFA, including M&E. */
  constructionPsf: 520,
  /** Professional fees, as a share of construction cost. */
  professionalFeesPct: 0.08,
  /** As shares of gross development value (GDV). */
  marketingPct: 0.03,
  financePct: 0.05,
  profitPct: 0.15,
  /** Stamp duty and legal costs on the land price. */
  landCostsPct: 0.04,
} as const;

export interface PsfStats {
  count: number;
  p25: number;
  median: number;
  p75: number;
}

export interface ComparableProject {
  project: string;
  street: string;
  distanceM: number;
  transactions: number;
  medianPsf: number;
  latestMonth: string;
  saleTypes: string[];
  tenure: string;
}

export interface Range {
  low: number;
  base: number;
  high: number;
}

export interface Valuation {
  radiusM: number;
  fromMonth: string;
  propertyTypes: string[];
  newSale: PsfStats | null;
  resale: PsfStats | null;
  /** Median $psf in the last 6 months vs the 18 months before, all sale types. */
  trend: { recentMedian: number; priorMedian: number; changePct: number } | null;
  projects: ComparableProject[];
  launchPsf: Range & { basis: "new sales" | "resale plus new-launch premium" };
  landPsfPpr: Range;
  gfaSqft?: number;
  /** True when only the residential part of a mixed-use site's GFA is valued. */
  residentialGfaOnly: boolean;
  totalLandPrice?: Range;
}

/**
 * Residential GFA cap from URA's GFA notes on mixed-use sites, e.g.
 * "A maximum of 126,000 m2 of GFA for Residential use ..." -> 126000.
 */
export function residentialGfaCapSqm(gfaInfo?: string): number | undefined {
  const m = gfaInfo?.match(/maximum (?:of )?([\d,]+)\s*m2 of GFA (?:for|can be for) Residential/i);
  return m ? Number(m[1].replace(/,/g, "")) : undefined;
}

function quantile(sorted: number[], q: number): number {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return Math.round(sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo));
}

export function psfStats(rows: Transaction[]): PsfStats | null {
  if (rows.length === 0) return null;
  const s = rows.map((r) => r.psf).sort((a, b) => a - b);
  return { count: s.length, p25: quantile(s, 0.25), median: quantile(s, 0.5), p75: quantile(s, 0.75) };
}

/** "2026-10" minus n months -> "YYYY-MM" */
export function monthsBefore(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 - n, 1));
  return d.toISOString().slice(0, 7);
}

/** What a developer can pay per sqft of GFA, given a launch price per sqft. */
export function residualLandPsfPpr(launchPsf: number, a = ASSUMPTIONS): number {
  const revenue = launchPsf * a.saleableToGfa;
  const net = revenue * (1 - a.marketingPct - a.financePct - a.profitPct);
  const build = a.constructionPsf * (1 + a.professionalFeesPct);
  return Math.max(0, Math.round((net - build) / (1 + a.landCostsPct)));
}

/** Property types comparable to the site: ECs for EC sites, otherwise non-landed private homes. */
export function comparableTypes(developmentType: string): string[] {
  return /executive condominium/i.test(developmentType) ? ["Executive Condominium"] : ["Apartment", "Condominium"];
}

export function valueSite(
  center: LatLng,
  rows: Transaction[],
  opts: { developmentType: string; maxGfaSqm?: number; gfaInfo?: string },
  a = ASSUMPTIONS,
): Valuation | null {
  const latest = rows[0]?.month;
  if (!latest) return null;
  const fromMonth = monthsBefore(latest, a.lookbackMonths - 1);
  const types = new Set(comparableTypes(opts.developmentType));

  // Rows are newest first, so stop once we pass the lookback window.
  const candidates: (Transaction & { distanceM: number })[] = [];
  for (const r of rows) {
    if (r.month < fromMonth) break;
    if (r.lat === undefined || r.lng === undefined || !types.has(r.propertyType)) continue;
    const distanceM = haversineMeters(center, { lat: r.lat, lng: r.lng });
    if (distanceM <= a.fallbackRadiusM) candidates.push({ ...r, distanceM });
  }
  const within1km = candidates.filter((r) => r.distanceM <= a.radiusM);
  const radiusM = within1km.length >= a.minComparables ? a.radiusM : a.fallbackRadiusM;
  const comps = radiusM === a.radiusM ? within1km : candidates;
  if (comps.length === 0) return null;

  const newSale = psfStats(comps.filter((r) => r.saleType === "New Sale"));
  const resale = psfStats(comps.filter((r) => r.saleType !== "New Sale"));

  const recentFrom = monthsBefore(latest, 5);
  const recent = psfStats(comps.filter((r) => r.month >= recentFrom));
  const prior = psfStats(comps.filter((r) => r.month < recentFrom));
  const trend =
    recent && prior
      ? {
          recentMedian: recent.median,
          priorMedian: prior.median,
          changePct: Math.round(((recent.median - prior.median) / prior.median) * 1000) / 10,
        }
      : null;

  const byProject = new Map<string, (Transaction & { distanceM: number })[]>();
  for (const r of comps) byProject.set(r.project, [...(byProject.get(r.project) ?? []), r]);
  const projects: ComparableProject[] = [...byProject.values()]
    .map((list) => ({
      project: list[0].project,
      street: list[0].street,
      distanceM: Math.round(Math.min(...list.map((r) => r.distanceM))),
      transactions: list.length,
      medianPsf: psfStats(list)!.median,
      latestMonth: list[0].month,
      saleTypes: [...new Set(list.map((r) => r.saleType))],
      tenure: list[0].tenure,
    }))
    .sort((x, y) => x.distanceM - y.distanceM);

  const useNewSales = newSale !== null && newSale.count >= a.minNewSales;
  const basis = useNewSales ? newSale : resale!;
  const uplift = useNewSales ? 1 : 1 + a.newLaunchPremium;
  const launchPsf = {
    low: Math.round(basis.p25 * uplift),
    base: Math.round(basis.median * uplift),
    high: Math.round(basis.p75 * uplift),
    basis: useNewSales ? ("new sales" as const) : ("resale plus new-launch premium" as const),
  };
  const landPsfPpr = {
    low: residualLandPsfPpr(launchPsf.low, a),
    base: residualLandPsfPpr(launchPsf.base, a),
    high: residualLandPsfPpr(launchPsf.high, a),
  };
  const residentialCap = residentialGfaCapSqm(opts.gfaInfo);
  const valuedGfaSqm = residentialCap ?? opts.maxGfaSqm;
  const gfaSqft = valuedGfaSqm ? Math.round(valuedGfaSqm * SQM_TO_SQFT) : undefined;
  const totalLandPrice = gfaSqft
    ? { low: landPsfPpr.low * gfaSqft, base: landPsfPpr.base * gfaSqft, high: landPsfPpr.high * gfaSqft }
    : undefined;

  return {
    radiusM,
    fromMonth,
    propertyTypes: [...types],
    newSale,
    resale,
    trend,
    projects,
    launchPsf,
    landPsfPpr,
    gfaSqft,
    residentialGfaOnly: residentialCap !== undefined,
    totalLandPrice,
  };
}
