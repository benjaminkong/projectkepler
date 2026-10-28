#!/usr/bin/env node
// Downloads public datasets from data.gov.sg (and shopping malls from
// OpenStreetMap), normalises them to
// [{ name, lat, lng, detail? }] and writes them to data/*.json.
// Run weekly by the GitLab scheduled pipeline: `npm run data:refresh`.
//
// Optional env: ONEMAP_EMAIL / ONEMAP_PASSWORD for a OneMap token (faster geocoding).

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "data");

const DATASETS = {
  mrt: "d_b39d3a0871985372d7e1637193335da5", // LTA MRT Station Exit (GEOJSON)
  hawker: "d_4a086da0a5553be1d89383cd90d07ecd", // NEA Hawker Centres (GEOJSON)
  park: "d_0542d48f0991541706b58059381a6eca", // NParks Parks (GEOJSON)
  schools: "d_688b934f82c1059ed0a6993d2a829089", // MOE General information of schools (CSV)
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (n) => Math.round(n * 1e6) / 1e6;

const SMALL_WORDS = new Set(["of", "and", "the", "at", "by"]);
function titleCase(s) {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((w, i) => {
      if (/^(mrt|lrt|cc|chas|pa|sg)$/.test(w)) return w.toUpperCase();
      if (i > 0 && SMALL_WORDS.has(w)) return w;
      return w.replace(/(^|[-(/'])(\p{L})/gu, (_, p, c) => p + c.toUpperCase());
    })
    .join(" ");
}

async function download(datasetId) {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const poll = await fetch(
      `https://api-open.data.gov.sg/v1/public/api/datasets/${datasetId}/poll-download`,
    ).then((r) => r.json());
    const url = poll?.data?.url;
    if (url) {
      const res = await fetch(url);
      if (res.ok) return res.text();
    }
    const wait = 5000 * attempt;
    console.log(`  ${datasetId}: not ready (${poll?.errorMsg ?? "no url"}), retrying in ${wait / 1000}s`);
    await sleep(wait);
  }
  throw new Error(`Could not download ${datasetId}`);
}

const points = (geojson) =>
  JSON.parse(geojson).features.filter((f) => f.geometry?.type === "Point");

const lngLat = (f) => ({ lng: round(f.geometry.coordinates[0]), lat: round(f.geometry.coordinates[1]) });

function buildMrt(geojson) {
  // Exits -> one point per station (mean of its exits).
  const stations = new Map();
  for (const f of points(geojson)) {
    const name = f.properties.STATION_NA;
    const s = stations.get(name) ?? { lat: 0, lng: 0, n: 0 };
    s.lat += f.geometry.coordinates[1];
    s.lng += f.geometry.coordinates[0];
    s.n += 1;
    stations.set(name, s);
  }
  return [...stations].map(([name, s]) => ({
    name: titleCase(name),
    lat: round(s.lat / s.n),
    lng: round(s.lng / s.n),
  }));
}

function buildHawker(geojson) {
  return points(geojson)
    .filter((f) => /existing|interim/i.test(f.properties.STATUS ?? "Existing"))
    .map((f) => ({ name: f.properties.NAME, ...lngLat(f), detail: f.properties.ADDRESS_MYENV }));
}

function buildPark(geojson) {
  const expand = { PG: "Playground", PK: "Park", OS: "Open Space", FC: "Fitness Corner", "(FCP)": "(Fitness Corner)" };
  return points(geojson).map((f) => ({
    name: titleCase(f.properties.NAME.split(" ").map((w) => expand[w] ?? w).join(" ")),
    ...lngLat(f),
  }));
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') (field += '"'), i++;
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") row.push(field), (field = "");
    else if (c === "\n") row.push(field.replace(/\r$/, "")), rows.push(row), (row = []), (field = "");
    else field += c;
  }
  if (field || row.length) row.push(field), rows.push(row);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

async function oneMapToken() {
  const { ONEMAP_EMAIL: email, ONEMAP_PASSWORD: password } = process.env;
  if (!email || !password) return null;
  const res = await fetch("https://www.onemap.gov.sg/api/auth/post/getToken", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  return res.ok ? (await res.json()).access_token : null;
}

async function geocodePostal(postal, token) {
  const url = `https://www.onemap.gov.sg/api/common/elastic/search?searchVal=${postal}&returnGeom=Y&getAddrDetails=N&pageNum=1`;
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, token ? { headers: { Authorization: token } } : {});
    if (res.status === 429) {
      await sleep(3000 * attempt);
      continue;
    }
    const r = (await res.json()).results?.[0];
    return r ? { lat: round(Number(r.LATITUDE)), lng: round(Number(r.LONGITUDE)) } : null;
  }
  return null;
}

async function buildPrimarySchools(csv) {
  // Reuse coordinates from the last run so only new or moved schools are geocoded.
  let previous = [];
  try {
    previous = JSON.parse(await readFile(path.join(DATA_DIR, "primary_schools.json"), "utf8"));
  } catch {}
  const cache = new Map(previous.map((s) => [s.postal, s]));

  const token = await oneMapToken();
  const delay = token ? 250 : 1500; // anonymous OneMap search is rate-limited
  const schools = parseCsv(csv).filter((s) => /^PRIMARY$|P1/.test(s.mainlevel_code));
  const out = [];
  for (const s of schools) {
    const postal = s.postal_code.padStart(6, "0");
    let coords = cache.get(postal);
    if (!coords) {
      coords = await geocodePostal(postal, token);
      await sleep(delay);
    }
    if (!coords) {
      console.warn(`  could not geocode ${s.school_name} (${postal})`);
      continue;
    }
    out.push({
      name: titleCase(s.school_name),
      lat: coords.lat,
      lng: coords.lng,
      detail: titleCase(s.address).trim(),
      postal,
    });
  }
  return out;
}

// Shopping malls: OpenStreetMap `shop=mall` via the Overpass API (© OpenStreetMap
// contributors, ODbL). Public Overpass servers are often busy, so retry and fall
// back to a mirror; if all fail, keep the existing data/mall.json.
const OVERPASS_SERVERS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"];
const SG_BBOX = "1.15,103.6,1.48,104.1";

async function fetchOsmMalls() {
  const query = `[out:json][timeout:60];nwr["shop"="mall"](${SG_BBOX});out center tags;`;
  for (let attempt = 1; attempt <= 6; attempt++) {
    const server = OVERPASS_SERVERS[(attempt - 1) % OVERPASS_SERVERS.length];
    try {
      const res = await fetch(server, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "TenderSitesPortal/0.1" },
        body: `data=${encodeURIComponent(query)}`,
      });
      if (res.ok) return (await res.json()).elements;
      console.log(`  overpass ${res.status} from ${server}`);
    } catch (err) {
      console.log(`  overpass error from ${server}: ${err.message}`);
    }
    await sleep(10000 * attempt);
  }
  return null;
}

function buildMall(elements) {
  const malls = [];
  for (const e of elements) {
    const name = e.tags?.name?.trim();
    const lat = e.lat ?? e.center?.lat;
    const lng = e.lon ?? e.center?.lon;
    if (!name || lat == null || lng == null) continue;
    // OSM sometimes maps one mall twice (e.g. "Liat Tower" and "Liat Towers"):
    // drop a mall within 150 m of one already kept with a near-identical name.
    const key = name.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/s$/, "");
    const dup = malls.some(
      (m) => m.key === key && Math.abs(m.lat - lat) < 0.00135 && Math.abs(m.lng - lng) < 0.00135,
    );
    if (dup) continue;
    const street = [e.tags["addr:housenumber"], e.tags["addr:street"]].filter(Boolean).join(" ");
    malls.push({ key, name, lat: round(lat), lng: round(lng), detail: street || undefined });
  }
  return malls.map(({ key, ...m }) => m);
}

async function save(name, rows) {
  // Drop empty optional fields so every row matches { name, lat, lng, detail? }.
  for (const r of rows) for (const k of Object.keys(r)) if (r[k] == null || r[k] === "") delete r[k];
  rows.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(path.join(DATA_DIR, `${name}.json`), JSON.stringify(rows, null, 1) + "\n");
  console.log(`  wrote data/${name}.json (${rows.length} rows)`);
}

const builders = {
  mrt: buildMrt,
  hawker: buildHawker,
  park: buildPark,
};

for (const [name, build] of Object.entries(builders)) {
  console.log(`Downloading ${name}...`);
  await save(name, build(await download(DATASETS[name])));
  await sleep(3000); // data.gov.sg rate-limits anonymous downloads
}
console.log("Downloading shopping malls (OpenStreetMap)...");
const osmMalls = await fetchOsmMalls();
if (osmMalls) await save("mall", buildMall(osmMalls));
else console.warn("  Overpass unavailable, keeping the existing data/mall.json");

console.log("Downloading primary schools...");
await save("primary_schools", await buildPrimarySchools(await download(DATASETS.schools)));
console.log("Done.");
