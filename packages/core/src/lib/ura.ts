import * as cheerio from "cheerio";
import { cached } from "./cache";
import { polygonsCentroid, type LatLng } from "./geo";
export { daysUntil } from "./dates";

export const URA_BASE = "https://www.ura.gov.sg";
export const URA_LIST_URL = `${URA_BASE}/land-sales/sites-for-tender/`;
/** Every current URA GLS site with its status (the landing page's source). */
export const URA_GLS_URL = `${URA_BASE}/land-sales/current-ura-gls-sites/`;
const ARCGIS_SALE_SITES =
  "https://maps.ura.gov.sg/ArcGis/rest/services/lsag/ura_sale_sites/MapServer/0/query";
const ONEMAP_SEARCH = "https://www.onemap.gov.sg/api/common/elastic/search";

/** Refresh upstream data at most every 6 hours (FR-1.8, NFR-7). */
export const REVALIDATE_SECONDS = 6 * 60 * 60;

const SLUG_RE = /^[a-z0-9-]+$/;
const USER_AGENT = "TenderSitesPortal/0.1 (+https://www.ura.gov.sg/land-sales/sites-for-tender/)";

export interface ParcelFacts {
  siteAreaSqm?: number;
  maxGfaSqm?: number;
  grossPlotRatio?: number;
  housingUnits?: number;
  leaseYears?: number;
  planningArea?: string;
  region?: string;
  developmentCode?: string;
  remarks?: string;
  gfaInfo?: string;
  pressReleaseUrl?: string;
  technicalDocsUrl?: string;
}

export interface TenderSite {
  slug: string;
  name: string;
  /** e.g. "Residential development" */
  developmentType: string;
  /** Raw text from URA, e.g. "29 October 2026, 9.00 am - 12.00 pm" */
  tenderSubmissionText: string;
  /** ISO date of the tender close day (Singapore time), when known. */
  tenderCloseDate?: string;
  imageUrl?: string;
  uraUrl: string;
  center: LatLng | null;
  /** GeoJSON MultiPolygon coordinates of the land parcel, when URA publishes one. */
  parcel?: number[][][][];
  facts: ParcelFacts;
  /** Proof-of-concept site added by config (POC_SITE_SLUGS), not on URA's current list. */
  poc?: boolean;
  /** URA's status, e.g. "Open for tender", "Tender closed", "Awarded", "Est. launch Nov 2026". */
  status?: string;
  /** Estimated launch month for sites not yet launched, e.g. "Nov 2026". */
  estimatedLaunch?: string;
  /** Normalised status, for filtering. */
  statusKey?: StatusKey;
  /** URA's site id (links to URA's map, ?site=<id>). */
  siteId?: number;
  /** Section on URA's GLS page, e.g. "Residential Sites". */
  category?: string;
}

export type StatusKey = "open" | "closed" | "awarded" | "upcoming" | "other";

/** "Open for Tender" -> open, "Tender closed" -> closed, "Nov-2026 *" -> upcoming, ... */
export function statusKey(status: string): StatusKey {
  const s = status.trim().toLowerCase();
  if (s.startsWith("open for tender")) return "open";
  if (s.startsWith("tender closed")) return "closed";
  if (s.startsWith("awarded")) return "awarded";
  if (/^[a-z]{3}-\d{4}/.test(s)) return "upcoming";
  return "other";
}

/** URA's status text cleaned up for display. */
export function statusLabel(status: string): string {
  const key = statusKey(status);
  if (key === "open") return "Open for tender";
  if (key === "closed") return "Tender closed";
  if (key === "awarded") return "Awarded";
  if (key === "upcoming") return `Est. launch ${estimatedLaunch(status)}`;
  return status.trim();
}

/** URA's estimated launch month for a site not yet launched: "Nov-2026 *" -> "Nov 2026". */
export function estimatedLaunch(status: string): string | undefined {
  const m = status.trim().match(/^([A-Za-z]{3})-(\d{4})/);
  return m ? `${m[1][0].toUpperCase()}${m[1].slice(1).toLowerCase()} ${m[2]}` : undefined;
}

/** A site row from the Confirmed List on URA's "Current URA GLS Sites" page. */
export interface GlsRow {
  siteId: number;
  name: string;
  category: string;
  siteAreaHa?: number;
  grossPlotRatio?: number;
  status: string;
}

/**
 * Parses the Confirmed List table on URA's "Current URA GLS Sites" page (the first table;
 * the Reserve List that follows is ignored). Exported for tests.
 */
export function parseGlsSitesHtml(html: string): { rows: GlsRow[]; uraLastUpdated?: string } {
  const $ = cheerio.load(html);
  const rows: GlsRow[] = [];
  const table = $("table").first();
  let category = "";
  table.find("tr").each((_, tr) => {
    const cells = $(tr).find("td, th");
    const link = $(tr).find('a[href*="site="]').first();
    if (!link.length) {
      // Section rows such as "Residential Sites" span the table.
      const text = $(tr).text().trim();
      if (cells.length === 1 && text) category = text;
      return;
    }
    const siteId = Number(new URL(link.attr("href")!.replace(/&amp;/g, "&"), URA_BASE).searchParams.get("site"));
    if (!siteId) return;
    link.find("span").remove(); // "↗" and "(opens in new tab)"
    const cellText = (i: number) => cells.eq(i).text().trim();
    rows.push({
      siteId,
      name: link.text().trim(),
      category,
      siteAreaHa: Number(cellText(2)) || undefined,
      grossPlotRatio: Number(cellText(3)) || undefined,
      status: cellText(4),
    });
  });
  const lastUpdated = $("div")
    .filter((_, el) => /^Last updated on /.test($(el).text().trim()) && $(el).children().length === 0)
    .first()
    .text()
    .trim()
    .replace(/^Last updated on /, "");
  return { rows, uraLastUpdated: lastUpdated || undefined };
}

/** URL slug for a site: URA's page name when it has one, else "<name>-<site id>". */
export function siteSlug(webUrl: string | undefined, name: string, siteId: number): string {
  const fromUrl = webUrl?.replace(/\/+$/, "").split("/").pop()?.toLowerCase();
  if (fromUrl && SLUG_RE.test(fromUrl)) return fromUrl;
  const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${base}-${siteId}`;
}

/**
 * Extra sites shown for the proof of concept even though they are no longer on URA's
 * Sites for Tender page (e.g. a closed tender with documents already in the agent).
 * Comma-separated URA slugs; set POC_SITE_SLUGS="" to show none.
 */
export function pocSiteSlugs(): string[] {
  // Marina Gardens Lane, the first POC site, is now on URA's GLS page, so none are added by default.
  const raw = process.env.POC_SITE_SLUGS ?? "";
  return raw.split(",").map((s) => s.trim()).filter((s) => SLUG_RE.test(s));
}

export interface SiteList {
  sites: TenderSite[];
  /** "Last updated on ..." text from the URA page. */
  uraLastUpdated?: string;
  fetchedAt: string;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`GET ${url} failed: ${res.status}`);
  return res.text();
}

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

/** "29 October 2026, 9.00 am - 12.00 pm" -> "2026-10-29" */
export function parseSubmissionDate(text: string): string | undefined {
  const m = text.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (!m) return undefined;
  const month = MONTHS.indexOf(m[2].toLowerCase());
  if (month < 0) return undefined;
  return `${m[3]}-${String(month + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

/** Parses the URA "Sites for Tender" listing page. Exported for tests. */
export function parseSiteListHtml(html: string): Omit<SiteList, "fetchedAt"> {
  const $ = cheerio.load(html);
  const sites: TenderSite[] = [];
  const seen = new Set<string>();

  $('a[href^="/land-sales/sites-for-tender/"]').each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const slug = href.replace("/land-sales/sites-for-tender/", "").replace(/\/$/, "");
    if (!slug || !SLUG_RE.test(slug) || seen.has(slug)) return;

    const paragraphs = $(el).find("p");
    const name = paragraphs.first().text().trim();
    const description = paragraphs.eq(1).text().trim();
    if (!name) return; // navigation links, not site cards

    const [developmentType = "", submission = ""] = description.split("|").map((s) => s.trim());
    const tenderSubmissionText = submission.replace(/^Tender submission:\s*/i, "");
    seen.add(slug);
    sites.push({
      slug,
      name,
      developmentType,
      tenderSubmissionText,
      tenderCloseDate: parseSubmissionDate(tenderSubmissionText),
      imageUrl: $(el).find("img").attr("src") || undefined,
      uraUrl: `${URA_BASE}/land-sales/sites-for-tender/${slug}/`,
      center: null,
      facts: {},
    });
  });

  const lastUpdated = $("div")
    .filter((_, el) => /^Last updated on /.test($(el).text().trim()) && $(el).children().length === 0)
    .first()
    .text()
    .trim()
    .replace(/^Last updated on /, "");

  return { sites, uraLastUpdated: lastUpdated || undefined };
}

type ArcGisFeature = {
  properties: Record<string, unknown>;
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] } | null;
};

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
const str = (v: unknown) => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s && !/^(no|na|n\/a)$/i.test(s) && !s.includes("pr26-xx") ? s : undefined;
};

type ParcelInfo = NonNullable<ReturnType<typeof toParcel>>;

/** Parcel boundary + planning facts from features of URA's land sale sites layer. */
function toParcel(features: ArcGisFeature[]) {
  if (features.length === 0) return null;
  const polygons: number[][][][] = [];
  for (const f of features) {
    if (f.geometry?.type === "Polygon") polygons.push(f.geometry.coordinates as number[][][]);
    if (f.geometry?.type === "MultiPolygon") polygons.push(...(f.geometry.coordinates as number[][][][]));
  }
  const p = features[0].properties;
  const closeMs = num(p.DATE_CLOSG);
  const facts: ParcelFacts = {
    siteAreaSqm: num(p.SA_SQM),
    maxGfaSqm: num(p.GFA),
    grossPlotRatio: num(p.GPR),
    housingUnits: num(p.HOUSING_UN),
    leaseYears: Number(p.LEASE_YR) || undefined,
    planningArea: str(p.PLN_AREA_N),
    region: str(p.Region),
    developmentCode: str(p.DEVT_CODE),
    remarks: str(p.RMKS_GLS),
    gfaInfo: str(p.INFO_GFA),
    pressReleaseUrl: str(p.URL_LNCH),
    technicalDocsUrl: str(p.URL_DOCS),
  };
  return {
    polygons,
    facts,
    // ArcGIS stores dates as midnight Singapore time in epoch ms.
    closeDate: closeMs ? new Date(closeMs + 8 * 3600_000).toISOString().slice(0, 10) : undefined,
    name: str(p.NAME_GLS),
    developmentType: str(p.DEVT_ALLOW),
    status: str(p.SITE_STATUS),
    webUrl: str(p.URL_WEB),
  };
}

async function queryParcels(where: string): Promise<ArcGisFeature[]> {
  const params = new URLSearchParams({ where, outFields: "*", returnGeometry: "true", outSR: "4326", f: "geojson" });
  const json = JSON.parse(await fetchText(`${ARCGIS_SALE_SITES}?${params}`)) as { features?: ArcGisFeature[] };
  return json.features ?? [];
}

/** One parcel by its URA page slug. */
async function fetchParcel(slug: string): Promise<ParcelInfo | null> {
  return toParcel(await queryParcels(`URL_WEB LIKE '%${slug}%'`));
}

/** Many parcels by URA site id, in one request. */
async function fetchParcelsByIds(ids: number[]): Promise<Map<number, ParcelInfo>> {
  const out = new Map<number, ParcelInfo>();
  const safe = ids.filter((id) => Number.isInteger(id) && id > 0);
  if (safe.length === 0) return out;
  const bySite = new Map<number, ArcGisFeature[]>();
  for (const f of await queryParcels(`SITE_ID IN (${safe.join(",")})`)) {
    const id = Number(f.properties.SITE_ID);
    bySite.set(id, [...(bySite.get(id) ?? []), f]);
  }
  for (const [id, features] of bySite) {
    const parcel = toParcel(features);
    if (parcel) out.set(id, parcel);
  }
  return out;
}

/** Fallback when URA has no parcel polygon: geocode the site name in OneMap. */
export function geocodeName(name: string): Promise<LatLng | null> {
  return cached(`geocode:${name}`, REVALIDATE_SECONDS * 1000, () => geocodeUncached(name));
}

async function geocodeUncached(name: string): Promise<LatLng | null> {
  const params = new URLSearchParams({ searchVal: name, returnGeom: "Y", getAddrDetails: "N", pageNum: "1" });
  // Anonymous OneMap search rate-limits bursts (HTTP 429): retry twice with a pause.
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch(`${ONEMAP_SEARCH}?${params}`, { headers: { "User-Agent": USER_AGENT } });
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        continue;
      }
      if (!res.ok) return null;
      const json = (await res.json()) as { results?: { LATITUDE: string; LONGITUDE: string }[] };
      const r = json.results?.[0];
      return r ? { lat: Number(r.LATITUDE), lng: Number(r.LONGITUDE) } : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** POC sites built from URA's land sale sites layer alone (no listing page needed). */
async function getPocSites(skip: Set<string>): Promise<TenderSite[]> {
  const out: TenderSite[] = [];
  for (const slug of pocSiteSlugs()) {
    if (skip.has(slug)) continue;
    try {
      const parcel = await fetchParcel(slug);
      if (!parcel || parcel.polygons.length === 0) {
        console.warn(`[ura] POC site ${slug} not found in URA's land sale sites layer`);
        continue;
      }
      out.push({
        slug,
        name: parcel.name ?? slug,
        developmentType: parcel.developmentType ?? "",
        tenderSubmissionText: parcel.closeDate ? new Date(`${parcel.closeDate}T00:00:00+08:00`).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" }) : "",
        tenderCloseDate: parcel.closeDate,
        uraUrl: parcel.webUrl ?? `${URA_BASE}/land-sales/sites-for-tender/${slug}/`,
        center: polygonsCentroid(parcel.polygons),
        parcel: parcel.polygons,
        facts: parcel.facts,
        poc: true,
        status: parcel.status ? statusLabel(parcel.status) : undefined,
        statusKey: parcel.status ? statusKey(parcel.status) : undefined,
      });
    } catch (err) {
      console.error(`[ura] POC site ${slug} failed:`, err);
    }
  }
  return out;
}

const fmtCloseDate = (iso?: string) =>
  iso ? new Date(`${iso}T00:00:00+08:00`).toLocaleDateString("en-SG", { day: "numeric", month: "long", year: "numeric" }) : "";

/** Display order: open (closing soonest first), tender closed, upcoming, then awarded (latest first). */
const STATUS_ORDER: Record<StatusKey, number> = { open: 0, closed: 1, upcoming: 2, awarded: 3, other: 4 };
function compareSites(a: TenderSite, b: TenderSite): number {
  const byStatus = STATUS_ORDER[a.statusKey ?? "other"] - STATUS_ORDER[b.statusKey ?? "other"];
  if (byStatus) return byStatus;
  const da = a.tenderCloseDate ?? "9999";
  const db = b.tenderCloseDate ?? "9999";
  return a.statusKey === "awarded" ? db.localeCompare(da) : da.localeCompare(db);
}

/**
 * All Confirmed List sites on URA's "Current URA GLS Sites" page, with status, parcel
 * boundary and facts. Open sites also get the photo and exact tender time from the
 * "Sites for Tender" page.
 */
export function getTenderSites(): Promise<SiteList> {
  return cached("tender-sites", REVALIDATE_SECONDS * 1000, loadTenderSites);
}

async function loadTenderSites(): Promise<SiteList> {
  const gls = parseGlsSitesHtml(await fetchText(URA_GLS_URL));
  if (gls.rows.length === 0) console.warn("[ura] no sites parsed from the Current URA GLS Sites page");

  const [parcels, tenderPage] = await Promise.all([
    fetchParcelsByIds(gls.rows.map((r) => r.siteId)),
    fetchText(URA_LIST_URL)
      .then(parseSiteListHtml)
      .catch((err) => {
        console.warn("[ura] Sites for Tender page unavailable:", (err as Error).message);
        return { sites: [] as TenderSite[] };
      }),
  ]);
  const tenderBySlug = new Map(tenderPage.sites.map((t) => [t.slug, t]));

  const sites = await Promise.all(
    gls.rows.map(async (row): Promise<TenderSite> => {
      const parcel = parcels.get(row.siteId);
      const slug = siteSlug(parcel?.webUrl, row.name, row.siteId);
      const listed = tenderBySlug.get(slug);
      const center = parcel?.polygons.length ? polygonsCentroid(parcel.polygons) : await geocodeName(row.name);
      const closeDate = listed?.tenderCloseDate ?? parcel?.closeDate;
      return {
        slug,
        name: row.name,
        developmentType: listed?.developmentType || parcel?.developmentType || row.category.replace(/ Sites$/, ""),
        tenderSubmissionText: listed?.tenderSubmissionText || fmtCloseDate(closeDate),
        tenderCloseDate: statusKey(row.status) === "upcoming" ? undefined : closeDate,
        imageUrl: listed?.imageUrl,
        uraUrl: parcel?.webUrl ?? `https://eservice.ura.gov.sg/maps/?service=GLSRELEASE&site=${row.siteId}`,
        center,
        parcel: parcel?.polygons,
        facts: { ...(parcel?.facts ?? {}), grossPlotRatio: parcel?.facts.grossPlotRatio ?? row.grossPlotRatio, siteAreaSqm: parcel?.facts.siteAreaSqm ?? (row.siteAreaHa ? row.siteAreaHa * 10_000 : undefined) },
        status: statusLabel(row.status),
        statusKey: statusKey(row.status),
        estimatedLaunch: estimatedLaunch(row.status),
        siteId: row.siteId,
        category: row.category,
      };
    }),
  );
  sites.sort(compareSites);
  const poc = await getPocSites(new Set(sites.map((s) => s.slug)));
  return { sites: [...sites, ...poc], uraLastUpdated: gls.uraLastUpdated, fetchedAt: new Date().toISOString() };
}

export async function getTenderSite(slug: string): Promise<TenderSite | null> {
  if (!SLUG_RE.test(slug)) return null;
  const { sites } = await getTenderSites();
  return sites.find((s) => s.slug === slug) ?? null;
}
