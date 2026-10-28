import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/transactions";
import { ASSUMPTIONS, monthsBefore, residentialGfaCapSqm, residualLandPsfPpr, valueSite } from "@/lib/valuation";

const site = { lat: 1.3, lng: 103.8 };
const near = (metresNorth: number) => ({ lat: site.lat + metresNorth / 111_195, lng: site.lng });

function txn(over: Partial<Transaction>): Transaction {
  return {
    project: "P", street: "S", district: "10", marketSegment: "CCR", propertyType: "Condominium",
    saleType: "Resale", tenure: "Freehold", floorRange: "01-05", noOfUnits: 1, areaSqm: 100,
    price: 2_000_000, psf: 2000, month: "2026-09", ...near(300), ...over,
  };
}

describe("residualLandPsfPpr", () => {
  it("takes costs and profit off the launch price", () => {
    // 3000 * (1 - 0.03 - 0.05 - 0.15) = 2310; build 520 * 1.08 = 561.6; (2310 - 561.6) / 1.04 = 1681
    expect(residualLandPsfPpr(3000)).toBe(1681);
    expect(residualLandPsfPpr(500)).toBe(0); // never negative
  });
});

describe("monthsBefore", () => {
  it("crosses year boundaries", () => expect(monthsBefore("2026-02", 3)).toBe("2025-11"));
});

describe("valueSite", () => {
  it("prices from nearby new sales when there are enough", () => {
    const rows = [
      ...Array.from({ length: 12 }, (_, i) => txn({ saleType: "New Sale", psf: 2900 + i * 20, project: "NEW" })),
      ...Array.from({ length: 30 }, () => txn({ psf: 2000 })),
      txn({ psf: 9999, ...near(5000) }), // too far
      txn({ psf: 9999, propertyType: "Terrace" }), // landed, not comparable
    ];
    const v = valueSite(site, rows, { developmentType: "Residential development", maxGfaSqm: 10_000 })!;
    expect(v.radiusM).toBe(1000);
    expect(v.newSale?.count).toBe(12);
    expect(v.launchPsf.basis).toBe("new sales");
    expect(v.launchPsf.base).toBe(v.newSale!.median);
    expect(v.landPsfPpr.base).toBe(residualLandPsfPpr(v.launchPsf.base));
    expect(v.totalLandPrice!.base).toBe(v.landPsfPpr.base * Math.round(10_000 * 10.7639));
  });

  it("falls back to resale plus premium, and widens to 2 km when comparables are thin", () => {
    const rows = Array.from({ length: 5 }, () => txn({ psf: 2000, ...near(1500) }));
    const v = valueSite(site, rows, { developmentType: "Residential development" })!;
    expect(v.radiusM).toBe(2000);
    expect(v.launchPsf.basis).toBe("resale plus new-launch premium");
    expect(v.launchPsf.base).toBe(Math.round(2000 * (1 + ASSUMPTIONS.newLaunchPremium)));
    expect(v.totalLandPrice).toBeUndefined();
  });

  it("returns null with no comparables", () => {
    expect(valueSite(site, [txn({ ...near(9000) })], { developmentType: "Residential" })).toBeNull();
  });
});

describe("residentialGfaCapSqm", () => {
  it("reads the residential cap from URA's GFA notes", () => {
    const info = "A maximum of 126,000 m2 of GFA for Residential use, of which a maximum GFA of 102,000 m2 shall be for Flats.";
    expect(residentialGfaCapSqm(info)).toBe(126000);
    expect(residentialGfaCapSqm(undefined)).toBeUndefined();
  });
});
