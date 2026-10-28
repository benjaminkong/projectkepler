export interface LatLng {
  lat: number;
  lng: number;
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

type Ring = number[][]; // [lng, lat] pairs, GeoJSON order

/** Area-weighted centroid of the outer rings of one or more polygons. */
export function polygonsCentroid(polygons: Ring[][]): LatLng | null {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (const poly of polygons) {
    const ring = poly[0];
    if (!ring || ring.length < 3) continue;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x0, y0] = ring[j];
      const [x1, y1] = ring[i];
      const f = x0 * y1 - x1 * y0;
      area += f;
      cx += (x0 + x1) * f;
      cy += (y0 + y1) * f;
    }
  }
  if (area === 0) return null;
  return { lng: cx / (3 * area), lat: cy / (3 * area) };
}

export function formatDistance(meters: number): string {
  return meters < 1000 ? `${Math.round(meters / 10) * 10} m` : `${(meters / 1000).toFixed(1)} km`;
}

// SVY21 (Singapore's projected grid, used by URA) -> WGS84, using the standard
// Transverse Mercator inverse with SVY21's published parameters.
const SVY21 = (() => {
  const a = 6378137;
  const f = 1 / 298.257223563;
  const b = a * (1 - f);
  const e2 = 2 * f - f * f;
  const e4 = e2 * e2;
  const e6 = e4 * e2;
  const n = (a - b) / (a + b);
  const n2 = n * n;
  const n3 = n2 * n;
  const n4 = n2 * n2;
  return {
    a, e2, n, n2, n3, n4,
    oLat: 1.366666, oLon: 103.833333, oN: 38744.572, oE: 28001.642, k: 1,
    A0: 1 - e2 / 4 - (3 * e4) / 64 - (5 * e6) / 256,
    A2: (3 / 8) * (e2 + e4 / 4 + (15 * e6) / 128),
    A4: (15 / 256) * (e4 + (3 * e6) / 4),
    A6: (35 * e6) / 3072,
    G: a * (1 - n) * (1 - n2) * (1 + (9 * n2) / 4 + (225 * n4) / 64) * (Math.PI / 180),
  };
})();

function meridianDistance(latDeg: number): number {
  const { a, A0, A2, A4, A6 } = SVY21;
  const r = toRad(latDeg);
  return a * (A0 * r - A2 * Math.sin(2 * r) + A4 * Math.sin(4 * r) - A6 * Math.sin(6 * r));
}

export function svy21ToWgs84(northing: number, easting: number): LatLng {
  const { a, e2, n, n2, n3, n4, oLat, oLon, oN, oE, k, G } = SVY21;
  const sigma = ((meridianDistance(oLat) + (northing - oN) / k) / G) * (Math.PI / 180);
  const latP =
    sigma +
    ((3 * n) / 2 - (27 * n3) / 32) * Math.sin(2 * sigma) +
    ((21 * n2) / 16 - (55 * n4) / 32) * Math.sin(4 * sigma) +
    ((151 * n3) / 96) * Math.sin(6 * sigma) +
    ((1097 * n4) / 512) * Math.sin(8 * sigma);

  const sin2 = Math.sin(latP) ** 2;
  const rho = (a * (1 - e2)) / Math.pow(1 - e2 * sin2, 1.5);
  const v = a / Math.sqrt(1 - e2 * sin2);
  const psi = v / rho;
  const [psi2, psi3, psi4] = [psi ** 2, psi ** 3, psi ** 4];
  const t = Math.tan(latP);
  const [t2, t4, t6] = [t ** 2, t ** 4, t ** 6];
  const eP = easting - oE;
  const x = eP / (k * v);
  const [x3, x5, x7] = [x ** 3, x ** 5, x ** 7];

  const latFactor = t / (k * rho);
  const lat =
    latP -
    latFactor * ((eP * x) / 2) +
    latFactor * ((eP * x3) / 24) * (-4 * psi2 + 9 * psi * (1 - t2) + 12 * t2) -
    latFactor *
      ((eP * x5) / 720) *
      (8 * psi4 * (11 - 24 * t2) - 12 * psi3 * (21 - 71 * t2) + 15 * psi2 * (15 - 98 * t2 + 15 * t4) + 180 * psi * (5 * t2 - 3 * t4) + 360 * t4) +
    latFactor * ((eP * x7) / 40320) * (1385 - 3633 * t2 + 4095 * t4 + 1575 * t6);

  const sec = 1 / Math.cos(lat);
  const lon =
    toRad(oLon) +
    x * sec -
    ((x3 * sec) / 6) * (psi + 2 * t2) +
    ((x5 * sec) / 120) * (-4 * psi3 * (1 - 6 * t2) + psi2 * (9 - 68 * t2) + 72 * psi * t2 + 24 * t4) -
    ((x7 * sec) / 5040) * (61 + 662 * t2 + 1320 * t4 + 720 * t6);

  return { lat: (lat * 180) / Math.PI, lng: (lon * 180) / Math.PI };
}
