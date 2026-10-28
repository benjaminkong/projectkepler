import { describe, expect, it } from "vitest";
import { contractMonth, filterTransactions, listProjects, median, normalise } from "@/lib/transactions";

const raw = [
  {
    project: "GRAND DUNMAN",
    street: "DUNMAN ROAD",
    marketSegment: "RCR",
    transaction: [
      { area: "100", contractDate: "0926", district: "15", floorRange: "06-10", noOfUnits: "1", price: "2000000", propertyType: "Condominium", tenure: "99 yrs lease commencing from 2022", typeOfSale: "1" },
      { area: "80", contractDate: "0125", district: "15", floorRange: "01-05", noOfUnits: "1", price: "1500000", propertyType: "Condominium", tenure: "99 yrs lease commencing from 2022", typeOfSale: "3" },
    ],
  },
  {
    project: "THE SAIL @ MARINA BAY",
    street: "MARINA BOULEVARD",
    marketSegment: "CCR",
    transaction: [
      { area: "120", contractDate: "0626", district: "01", floorRange: "41-45", noOfUnits: "1", price: "3200000", propertyType: "Apartment", tenure: "99 yrs lease commencing from 2002", typeOfSale: "3" },
    ],
  },
];

describe("normalise", () => {
  const rows = normalise(raw);

  it("flattens projects, newest month first", () => {
    expect(rows.map((r) => r.month)).toEqual(["2026-09", "2026-06", "2025-01"]);
  });

  it("maps sale type and computes $psf from square metres", () => {
    expect(rows[0]).toMatchObject({ saleType: "New Sale", project: "GRAND DUNMAN", psf: 1858 });
  });
});

describe("filterTransactions", () => {
  const rows = normalise(raw);

  it("filters by districts, projects, price and date", () => {
    expect(filterTransactions(rows, { districts: ["15"] })).toHaveLength(2);
    expect(filterTransactions(rows, { districts: ["15", "01"] })).toHaveLength(3);
    expect(filterTransactions(rows, { projects: ["GRAND DUNMAN"] })).toHaveLength(2);
    expect(filterTransactions(rows, { projects: ["GRAND DUNMAN", "THE SAIL @ MARINA BAY"] })).toHaveLength(3);
    expect(filterTransactions(rows, { districts: [], projects: [] })).toHaveLength(3);
    expect(filterTransactions(rows, { priceFrom: 1_600_000, priceTo: 3_000_000 }).map((r) => r.price)).toEqual([2_000_000]);
    expect(filterTransactions(rows, { dateFrom: "2026-01", dateTo: "2026-06" }).map((r) => r.month)).toEqual(["2026-06"]);
  });
});

describe("listProjects", () => {
  const rows = normalise(raw);
  it("lists distinct projects, limited to the chosen districts", () => {
    expect(listProjects(rows)).toEqual(["GRAND DUNMAN", "THE SAIL @ MARINA BAY"]);
    expect(listProjects(rows, ["01"])).toEqual(["THE SAIL @ MARINA BAY"]);
  });
});

describe("helpers", () => {
  it("converts MMYY to YYYY-MM", () => expect(contractMonth("0322")).toBe("2022-03"));
  it("takes the median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 10])).toBe(3);
    expect(median([])).toBeUndefined();
  });
});
