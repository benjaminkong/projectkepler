// Private residential transactions from the URA Data Service (PMI_Resi_Transaction).
// URA returns ~5 years of caveats in 4 batches (~29 MB, ~130k rows) with no server-side
// filtering, so we download everything, keep it in memory for 24 h and filter locally.
// To move to a database later, only `loadAllTransactions` / `getTransactions` change.
import { svy21ToWgs84 } from "./geo";

const URA_DS = "https://eservice.ura.gov.sg/uraDataService";
const BATCHES = [1, 2, 3, 4];
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const TOKEN_TTL_MS = 23 * 60 * 60 * 1000; // URA tokens last one day
// URA's gateway rejects requests without a browser-like User-Agent.
const USER_AGENT = "Mozilla/5.0 (compatible; TenderSitesPortal/0.1)";

export const SALE_TYPES: Record<string, string> = { "1": "New Sale", "2": "Sub Sale", "3": "Resale" };

/** URA postal districts and their general locations. */
export const DISTRICTS: Record<string, string> = {
  "01": "Raffles Place, Cecil, Marina, People's Park",
  "02": "Anson, Tanjong Pagar",
  "03": "Queenstown, Tiong Bahru",
  "04": "Telok Blangah, Harbourfront",
  "05": "Pasir Panjang, Hong Leong Garden, Clementi",
  "06": "High Street, Beach Road",
  "07": "Middle Road, Golden Mile",
  "08": "Little India",
  "09": "Orchard, Cairnhill, River Valley",
  "10": "Ardmore, Bukit Timah, Holland Road, Tanglin",
  "11": "Watten Estate, Novena, Thomson",
  "12": "Balestier, Toa Payoh, Serangoon",
  "13": "Macpherson, Braddell",
  "14": "Geylang, Eunos",
  "15": "Katong, Joo Chiat, Amber Road",
  "16": "Bedok, Upper East Coast, Eastwood",
  "17": "Loyang, Changi",
  "18": "Tampines, Pasir Ris",
  "19": "Serangoon Garden, Hougang, Punggol",
  "20": "Bishan, Ang Mo Kio",
  "21": "Upper Bukit Timah, Clementi Park, Ulu Pandan",
  "22": "Jurong",
  "23": "Hillview, Dairy Farm, Bukit Panjang, Choa Chu Kang",
  "24": "Lim Chu Kang, Tengah",
  "25": "Kranji, Woodgrove",
  "26": "Upper Thomson, Springleaf",
  "27": "Yishun, Sembawang",
  "28": "Seletar",
};

const SQM_TO_SQFT = 10.7639;

export interface Transaction {
  project: string;
  street: string;
  district: string;
  marketSegment: string;
  propertyType: string;
  saleType: string;
  tenure: string;
  floorRange: string;
  noOfUnits: number;
  areaSqm: number;
  price: number;
  /** Price per square foot, rounded to the dollar. */
  psf: number;
  /** Contract month, "YYYY-MM". */
  month: string;
  /** Project location (from URA's SVY21 x/y), when URA gives one. */
  lat?: number;
  lng?: number;
}

interface RawProject {
  project: string;
  street: string;
  marketSegment: string;
  x?: string;
  y?: string;
  transaction: {
    area: string;
    contractDate: string; // "MMYY"
    district: string;
    floorRange: string;
    noOfUnits: string;
    price: string;
    propertyType: string;
    tenure: string;
    typeOfSale: string;
  }[];
}

/** "0526" -> "2026-05" */
export function contractMonth(mmyy: string): string {
  return `20${mmyy.slice(2, 4)}-${mmyy.slice(0, 2)}`;
}

export function normalise(projects: RawProject[]): Transaction[] {
  const rows: Transaction[] = [];
  for (const p of projects) {
    const x = Number(p.x);
    const y = Number(p.y);
    const at = x > 0 && y > 0 ? svy21ToWgs84(y, x) : undefined;
    for (const t of p.transaction ?? []) {
      const areaSqm = Number(t.area);
      const price = Number(t.price);
      if (!Number.isFinite(price) || !Number.isFinite(areaSqm) || areaSqm <= 0) continue;
      rows.push({
        project: p.project,
        street: p.street,
        district: t.district,
        marketSegment: p.marketSegment,
        propertyType: t.propertyType,
        saleType: SALE_TYPES[t.typeOfSale] ?? t.typeOfSale,
        tenure: t.tenure,
        floorRange: t.floorRange,
        noOfUnits: Number(t.noOfUnits) || 1,
        areaSqm,
        price,
        psf: Math.round(price / (areaSqm * SQM_TO_SQFT)),
        month: contractMonth(t.contractDate),
        lat: at?.lat,
        lng: at?.lng,
      });
    }
  }
  // Newest first, then by price, so the default view is "recent transactions".
  rows.sort((a, b) => b.month.localeCompare(a.month) || b.price - a.price);
  return rows;
}

function accessKey(): string {
  const key = process.env.URA_ACCESS_KEY;
  if (!key) throw new Error("URA_ACCESS_KEY is not set. Add it to .env.local or the host's environment.");
  return key;
}

// Module state lives on globalThis so dev hot reloads don't drop the cache.
type CacheState = {
  token?: { value: string; at: number };
  data?: { rows: Transaction[]; at: number };
  loading?: Promise<Transaction[]>;
};
const g = globalThis as typeof globalThis & { __uraTxnCache?: CacheState };
const cache: CacheState = (g.__uraTxnCache ??= {});

async function getToken(): Promise<string> {
  if (cache.token && Date.now() - cache.token.at < TOKEN_TTL_MS) return cache.token.value;
  const res = await fetch(`${URA_DS}/insertNewToken/v1`, {
    headers: { AccessKey: accessKey(), "User-Agent": USER_AGENT },
    cache: "no-store",
  });
  const json = (await res.json().catch(() => null)) as { Status?: string; Result?: string; Message?: string } | null;
  if (!res.ok || json?.Status !== "Success" || !json.Result) {
    throw new Error(`URA token request failed: ${res.status} ${json?.Message ?? ""}`.trim());
  }
  cache.token = { value: json.Result, at: Date.now() };
  return json.Result;
}

/** Some URA batches are Latin-1, not UTF-8 (e.g. "É" in project names). */
function decode(buf: ArrayBuffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder("latin1").decode(buf);
  }
}

async function fetchBatch(batch: number, token: string): Promise<RawProject[]> {
  const res = await fetch(`${URA_DS}/invokeUraDS/v1?service=PMI_Resi_Transaction&batch=${batch}`, {
    headers: { AccessKey: accessKey(), Token: token, "User-Agent": USER_AGENT },
    cache: "no-store", // ~5-12 MB per batch: too big for Next's data cache
  });
  if (!res.ok) throw new Error(`URA batch ${batch} failed: ${res.status}`);
  const json = JSON.parse(decode(await res.arrayBuffer())) as { Status?: string; Result?: RawProject[]; Message?: string };
  if (json.Status !== "Success" || !Array.isArray(json.Result)) {
    throw new Error(`URA batch ${batch} failed: ${json.Message ?? json.Status}`);
  }
  return json.Result;
}

async function loadAllTransactions(): Promise<Transaction[]> {
  const started = Date.now();
  const token = await getToken();
  const batches = await Promise.all(BATCHES.map((b) => fetchBatch(b, token)));
  const rows = normalise(batches.flat());
  console.log(`[transactions] loaded ${rows.length} rows in ${Date.now() - started} ms`);
  return rows;
}

/**
 * All transactions, newest first. Cached for 24 h. A stale cache is served
 * while it refreshes in the background, and kept if the refresh fails.
 */
export async function getTransactions(): Promise<{ rows: Transaction[]; loadedAt: string }> {
  const refresh = () => {
    cache.loading ??= loadAllTransactions()
      .then((rows) => {
        cache.data = { rows, at: Date.now() };
        return rows;
      })
      .finally(() => {
        cache.loading = undefined;
      });
    return cache.loading;
  };

  if (cache.data) {
    if (Date.now() - cache.data.at > CACHE_TTL_MS) {
      refresh().catch((err) => console.error("[transactions] background refresh failed:", err));
    }
    return { rows: cache.data.rows, loadedAt: new Date(cache.data.at).toISOString() };
  }
  const rows = await refresh();
  return { rows, loadedAt: new Date(cache.data!.at).toISOString() };
}

export interface TransactionFilters {
  /** Postal districts, e.g. ["09", "10"]. Empty or missing = all. */
  districts?: string[];
  /** Exact project names as URA spells them. Empty or missing = all. */
  projects?: string[];
  priceFrom?: number;
  priceTo?: number;
  /** "YYYY-MM", inclusive */
  dateFrom?: string;
  /** "YYYY-MM", inclusive */
  dateTo?: string;
}

export function filterTransactions(rows: Transaction[], f: TransactionFilters): Transaction[] {
  const districts = f.districts?.length ? new Set(f.districts) : null;
  const projects = f.projects?.length ? new Set(f.projects) : null;
  return rows.filter(
    (r) =>
      (!districts || districts.has(r.district)) &&
      (!projects || projects.has(r.project)) &&
      (f.priceFrom === undefined || r.price >= f.priceFrom) &&
      (f.priceTo === undefined || r.price <= f.priceTo) &&
      (!f.dateFrom || r.month >= f.dateFrom) &&
      (!f.dateTo || r.month <= f.dateTo),
  );
}

/** Distinct project names (A-Z), limited to the given districts when any are given. */
export function listProjects(rows: Transaction[], districts: string[] = []): string[] {
  const only = districts.length ? new Set(districts) : null;
  const names = new Set<string>();
  for (const r of rows) if (!only || only.has(r.district)) names.add(r.project);
  return [...names].sort();
}

export function median(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

// ---------------------------------------------------------------------------
// Private residential pipeline (PMI_Resi_Pipeline): uncompleted projects with
// total units and expected completion (TOP) year. Used by the Excel export.

export interface PipelineProject {
  project: string;
  district: string;
  totalUnits: number;
  /** e.g. "2028", or "na" when URA has no date yet. */
  expectedTOPYear: string;
  developerName: string;
}

type PipelineCache = { data?: { rows: PipelineProject[]; at: number }; loading?: Promise<PipelineProject[]> };
const gp = globalThis as typeof globalThis & { __uraPipeline?: PipelineCache };
const pipelineCache: PipelineCache = (gp.__uraPipeline ??= {});

export async function getPipeline(): Promise<PipelineProject[]> {
  if (pipelineCache.data && Date.now() - pipelineCache.data.at < CACHE_TTL_MS) return pipelineCache.data.rows;
  pipelineCache.loading ??= (async () => {
    const res = await fetch(`${URA_DS}/invokeUraDS/v1?service=PMI_Resi_Pipeline`, {
      headers: { AccessKey: accessKey(), Token: await getToken(), "User-Agent": USER_AGENT },
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`URA pipeline failed: ${res.status}`);
    const json = JSON.parse(decode(await res.arrayBuffer())) as { Status?: string; Result?: PipelineProject[] };
    if (json.Status !== "Success" || !Array.isArray(json.Result)) throw new Error("URA pipeline failed");
    const rows = json.Result.map((p) => ({
      project: p.project,
      district: p.district,
      totalUnits: Number(p.totalUnits) || 0,
      expectedTOPYear: String(p.expectedTOPYear ?? "na"),
      developerName: String(p.developerName ?? "").trim(),
    }));
    pipelineCache.data = { rows, at: Date.now() };
    return rows;
  })().finally(() => {
    pipelineCache.loading = undefined;
  });
  return pipelineCache.loading;
}

// ---------------------------------------------------------------------------
// Developer sales (PMI_Resi_Developer_Sales): the developers' monthly survey, per project.
// Unlike the pipeline, its unit counts cover only the homes for sale, e.g. Newport Residences
// has 246 homes for sale but 487 units in the pipeline (which adds its serviced residences).

export interface DeveloperSales {
  project: string;
  /** Units in the project that are for sale. */
  unitsAvail: number;
  launchedToDate: number;
  soldToDate: number;
  /** URA reference month, "MMYY". */
  refPeriod: string;
}

type DevSalesCache = { data?: { rows: DeveloperSales[]; at: number }; loading?: Promise<DeveloperSales[]> };
const gd = globalThis as typeof globalThis & { __uraDevSales?: DevSalesCache };
const devSalesCache: DevSalesCache = (gd.__uraDevSales ??= {});

/** "MMYY" for this month and the few before it, newest first (URA publishes about a month late). */
function recentRefPeriods(count: number, now = new Date()): string[] {
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    return `${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCFullYear()).slice(2)}`;
  });
}

/** The latest month of developer sales URA has published. */
export async function getDeveloperSales(): Promise<DeveloperSales[]> {
  if (devSalesCache.data && Date.now() - devSalesCache.data.at < CACHE_TTL_MS) return devSalesCache.data.rows;
  devSalesCache.loading ??= (async () => {
    const token = await getToken();
    for (const refPeriod of recentRefPeriods(4)) {
      const res = await fetch(`${URA_DS}/invokeUraDS/v1?service=PMI_Resi_Developer_Sales&refPeriod=${refPeriod}`, {
        headers: { AccessKey: accessKey(), Token: token, "User-Agent": USER_AGENT },
        cache: "no-store",
      });
      if (!res.ok) continue;
      type Raw = { project: string; developerSales?: Omit<DeveloperSales, "project">[] };
      const json = JSON.parse(decode(await res.arrayBuffer())) as { Status?: string; Result?: Raw[] };
      if (json.Status !== "Success" || !json.Result?.length) continue;
      const rows = json.Result.flatMap((r) => {
        const m = r.developerSales?.[0];
        return m
          ? [{ project: r.project, unitsAvail: Number(m.unitsAvail) || 0, launchedToDate: Number(m.launchedToDate) || 0, soldToDate: Number(m.soldToDate) || 0, refPeriod: m.refPeriod }]
          : [];
      });
      devSalesCache.data = { rows, at: Date.now() };
      return rows;
    }
    throw new Error("URA developer sales unavailable");
  })().finally(() => {
    devSalesCache.loading = undefined;
  });
  return devSalesCache.loading;
}

// ---------------------------------------------------------------------------
// Filters from a query string, shared by the page and the Excel export.

/** `get(key)` returns every value for a query key (repeated keys allowed). */
export function filtersFromQuery(get: (key: string) => string[]): TransactionFilters {
  const clean = (k: string) => [...new Set(get(k).map((v) => v.trim()).filter(Boolean))];
  const money = (k: string) => {
    const n = Number((clean(k)[0] ?? "").replace(/[,$\s]/g, ""));
    return clean(k).length && Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const month = (k: string) => clean(k).find((v) => /^\d{4}-\d{2}$/.test(v));
  return {
    districts: clean("district").filter((d) => DISTRICTS[d]),
    projects: clean("project").map((p) => p.toUpperCase()),
    priceFrom: money("priceFrom"),
    priceTo: money("priceTo"),
    dateFrom: month("dateFrom"),
    dateTo: month("dateTo"),
  };
}
