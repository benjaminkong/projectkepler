import { describe, expect, it } from "vitest";
import { findNearby } from "@/lib/nearby";
import { haversineMeters, polygonsCentroid } from "@/lib/geo";

const site = { lat: 1.3, lng: 103.8 };
// ~111 m per 0.001 degree of latitude
const at = (metresNorth: number, name = `p${metresNorth}`) => ({ name, lat: site.lat + metresNorth / 111_195, lng: site.lng });

describe("haversineMeters", () => {
  it("measures 0.01 deg of latitude as ~1112 m", () => {
    expect(haversineMeters(site, { lat: 1.31, lng: 103.8 })).toBeCloseTo(1112, -1);
  });
});

describe("findNearby radius rule", () => {
  it("uses 1 km when anything is within 1 km, sorted by distance", () => {
    const r = findNearby(site, [at(900), at(300), at(1500)]);
    expect(r.widened).toBe(false);
    expect(r.radiusM).toBe(1000);
    expect(r.items.map((p) => p.name)).toEqual(["p300", "p900"]);
  });

  it("stays at 1 km for categories that do not widen", () => {
    const r = findNearby(site, [at(1500), at(1200)]);
    expect(r.widened).toBe(false);
    expect(r.items).toHaveLength(0);
  });

  it("widens to 2 km when nothing is within 1 km and widening is on", () => {
    const r = findNearby(site, [at(1500), at(1200), at(2500)], true);
    expect(r.widened).toBe(true);
    expect(r.radiusM).toBe(2000);
    expect(r.items.map((p) => p.name)).toEqual(["p1200", "p1500"]);
  });

  it("returns no items when nothing is within 2 km", () => {
    const r = findNearby(site, [at(3000)], true);
    expect(r.widened).toBe(true);
    expect(r.items).toHaveLength(0);
  });
});

describe("polygonsCentroid", () => {
  it("finds the centre of a square", () => {
    const square = [[[103, 1], [104, 1], [104, 2], [103, 2], [103, 1]]];
    expect(polygonsCentroid([square])).toEqual({ lat: 1.5, lng: 103.5 });
  });
});

import { svy21ToWgs84 } from "@/lib/geo";

describe("svy21ToWgs84", () => {
  it("matches NEA's own coordinates for Commonwealth Crescent Market", () => {
    // data.gov.sg gives both: SVY21 (24332.82, 32135.92) and WGS84 (1.3069001, 103.8003673)
    const p = svy21ToWgs84(32135.91866726, 24332.82477688);
    expect(p.lat).toBeCloseTo(1.3069001, 5);
    expect(p.lng).toBeCloseTo(103.8003673, 5);
  });
});
