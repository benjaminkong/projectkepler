// MRT/LRT line diagrams for the "Nearby MRT" page.
// Station codes, names and lines come from LTA's "Train Station Codes" list
// (data/train_stations.json); coordinates come from the LTA station exits dataset (data/mrt.json).
import trainStations from "../../data/train_stations.json";
import mrtPoints from "../../data/mrt.json";
import { haversineMeters, type LatLng } from "./geo";
import { walkingDistances } from "./walking";

/** Official line colours. */
export const LINE_COLORS: Record<string, string> = {
  red: "#d42e12",
  green: "#009645",
  purple: "#9900aa",
  yellow: "#fa9e0d",
  blue: "#005ec4",
  grey: "#748477",
  brown: "#9d5b25",
};

/** Typical time between stations, used for the "≈ N mins" estimates. */
export const MINS_PER_STOP = 2;
/** Walking pace (about 4.8 km/h). */
export const WALK_METRES_PER_MIN = 80;
export const STATIONS_EACH_SIDE = 5;

interface StationCode {
  code: string;
  name: string;
  line: string;
  color: string;
}

const norm = (name: string) =>
  name
    .toLowerCase()
    .replace(/\s+(mrt|lrt) station$/, "")
    .replace(/[^a-z0-9]/g, "");

/**
 * Stations opened after the LTA codes list was published (2022). They appear in LTA's station
 * exits dataset, so they have locations; add them here so lines and nearest-station lookups see them.
 */
const NEWER_STATIONS: StationCode[] = [
  { code: "TE21", name: "Marina South", line: "Thomson-East Coast Line", color: "brown" },
  { code: "CC30", name: "Keppel", line: "Circle Line", color: "yellow" },
  { code: "CC31", name: "Cantonment", line: "Circle Line", color: "yellow" },
  { code: "CC32", name: "Prince Edward Road", line: "Circle Line", color: "yellow" },
];

const CODES = [
  ...(trainStations as StationCode[]),
  ...NEWER_STATIONS.filter((n) => !(trainStations as StationCode[]).some((s) => s.code === n.code)),
];

/** Every code for a station name, e.g. "dhobyghaut" -> NS24, NE6, CC1. */
const codesByStation = new Map<string, StationCode[]>();
for (const s of CODES) {
  const key = norm(s.name);
  codesByStation.set(key, [...(codesByStation.get(key) ?? []), s]);
}

const coordsByStation = new Map<string, LatLng>();
const codeToKey = new Map(CODES.map((s) => [s.code, norm(s.name)]));
for (const p of mrtPoints as { name: string; lat: number; lng: number }[]) {
  // Some exits in LTA's dataset are labelled only by station code (e.g. "Cc30"): map them to the station.
  const byCode = /^[a-z]{2}\d+$/i.test(p.name) ? codeToKey.get(p.name.toUpperCase()) : undefined;
  const key = byCode ?? norm(p.name);
  if (!coordsByStation.has(key)) coordsByStation.set(key, { lat: p.lat, lng: p.lng });
}

export interface LineStop {
  key: string;
  name: string;
  /** All codes at this station, for interchange badges. */
  codes: { code: string; color: string }[];
}

export interface Line {
  id: string;
  name: string;
  color: string;
  stops: LineStop[];
}

const codeNumber = (code: string) => Number(code.replace(/^[A-Z]+/, "")) || 0;

function stop(name: string): LineStop {
  const key = norm(name);
  const codes = (codesByStation.get(key) ?? [])
    .map((c) => ({ code: c.code, color: LINE_COLORS[c.color] ?? LINE_COLORS.grey }))
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));
  return { key, name: codesByStation.get(key)?.[0].name ?? name, codes };
}

/**
 * Lines as ordered stop lists. Stations are ordered by code number within each prefix
 * (EW1, EW2, ...). Short branches are joined to the station they leave from, and the
 * LRT loops (SE/SW, PE/PW) start at their town centre station.
 */
export const LINES: Line[] = (() => {
  const byPrefix = new Map<string, StationCode[]>();
  for (const s of CODES) {
    const prefix = s.code.match(/^[A-Z]+/)?.[0] ?? s.code;
    if (prefix === "STC" || prefix === "PTC") continue; // town centres, added below
    byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), s]);
  }
  // Branch prefix -> station it starts from.
  const startsFrom: Record<string, string> = { CG: "Tanah Merah", CE: "Promenade", SE: "Sengkang", SW: "Sengkang", PE: "Punggol", PW: "Punggol" };
  const lineNames: Record<string, string> = { SE: "Sengkang LRT (East)", SW: "Sengkang LRT (West)", PE: "Punggol LRT (East)", PW: "Punggol LRT (West)" };

  return [...byPrefix].map(([prefix, list]) => {
    const ordered = [...list].sort((a, b) => codeNumber(a.code) - codeNumber(b.code));
    const names = ordered.map((s) => s.name);
    if (startsFrom[prefix]) names.unshift(startsFrom[prefix]);
    return {
      id: prefix,
      name: lineNames[prefix] ?? ordered[0].line,
      color: LINE_COLORS[ordered[0].color] ?? LINE_COLORS.grey,
      stops: names.map(stop),
    };
  });
})();

export interface NearbyStation {
  key: string;
  name: string;
  /** Straight-line distance. */
  distanceM: number;
  /** Walking distance along paths, when a route was found. */
  walkM?: number;
  walkMins: number;
  codes: LineStop["codes"];
}

/** The `count` stations closest to a point (straight-line). */
export function nearestStations(center: LatLng, count = 3): NearbyStation[] {
  const candidates: NearbyStation[] = [];
  for (const [key, list] of codesByStation) {
    const at = coordsByStation.get(key);
    if (!at) continue;
    const distanceM = haversineMeters(center, at);
    candidates.push({
      key,
      name: list[0].name,
      distanceM,
      walkMins: Math.max(1, Math.round(distanceM / WALK_METRES_PER_MIN)),
      codes: stop(list[0].name).codes,
    });
  }
  return candidates.sort((a, b) => a.distanceM - b.distanceM).slice(0, count);
}

/**
 * The `count` stations closest on foot: routes to the nearest few by straight line, then ranks by
 * walking distance (a station across a canal or expressway can be close but a long walk).
 * Falls back to straight-line ranking if routing is unavailable.
 */
export async function nearestStationsByWalking(center: LatLng, count = 3, shortlist = 8): Promise<NearbyStation[]> {
  const near = nearestStations(center, shortlist);
  const walks = await walkingDistances(center, near.map((s) => coordsByStation.get(s.key)!));
  return near
    .map((s, i) => {
      const walkM = walks[i] ?? undefined;
      return walkM === undefined ? s : { ...s, walkM, walkMins: Math.max(1, Math.round(walkM / WALK_METRES_PER_MIN)) };
    })
    .sort((a, b) => (a.walkM ?? a.distanceM) - (b.walkM ?? b.distanceM))
    .slice(0, count);
}

export interface DiagramStop extends LineStop {
  starred: boolean;
  /** Stops to the nearest starred station on this line (0 for starred stations). */
  stopsAway: number;
}

export interface DiagramRow {
  line: Line;
  stops: DiagramStop[];
  /** Starred stations on this row, nearest to the parcel first. */
  stars: NearbyStation[];
}

/**
 * One row per line that serves a starred station: the starred stations plus up to
 * `STATIONS_EACH_SIDE` stations beyond them in each direction.
 */
export function buildDiagram(nearby: NearbyStation[]): DiagramRow[] {
  const starKeys = new Set(nearby.map((s) => s.key));
  const rows: DiagramRow[] = [];
  for (const line of LINES) {
    const starIdx = line.stops.map((s, i) => (starKeys.has(s.key) ? i : -1)).filter((i) => i >= 0);
    if (starIdx.length === 0) continue;
    const from = Math.max(0, Math.min(...starIdx) - STATIONS_EACH_SIDE);
    const to = Math.min(line.stops.length - 1, Math.max(...starIdx) + STATIONS_EACH_SIDE);
    const stops = line.stops.slice(from, to + 1).map((s, j) => {
      const i = from + j;
      return { ...s, starred: starKeys.has(s.key), stopsAway: Math.min(...starIdx.map((k) => Math.abs(i - k))) };
    });
    rows.push({ line, stops, stars: nearby.filter((n) => stops.some((s) => s.starred && s.key === n.key)) });
  }
  // Rows for the closest station first.
  const d = (s: NearbyStation) => s.walkM ?? s.distanceM;
  return rows.sort((a, b) => d(a.stars[0]) - d(b.stars[0]));
}

const LRT_CODE = /^(BP|SE|SW|PE|PW|STC|PTC)/;

/**
 * "250m to Marina South MRT", adding a second station when it is within 100 m of the first
 * ("400m to Prince Edward Road MRT & 450m to Tanjong Pagar MRT"). Distances are walking where
 * known, rounded to 50 m as in the comparables template.
 */
export function mrtWalkLabel(stations: NearbyStation[]): string {
  if (stations.length === 0) return "-";
  const dist = (s: NearbyStation) => s.walkM ?? s.distanceM;
  const label = (s: NearbyStation) => {
    const kind = s.codes.every((c) => LRT_CODE.test(c.code)) ? "LRT" : "MRT";
    return `${Math.max(50, Math.round(dist(s) / 50) * 50)}m to ${s.name} ${kind}`;
  };
  const [a, b] = stations;
  return b && dist(b) - dist(a) <= 100 ? `${label(a)} & ${label(b)}` : label(a);
}
