import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { Transaction } from "@/lib/transactions";
import { buildComparablesWorkbook, comparableRows, exportFileName, periodTitle, shortTenure, type ComparablesInput } from "@/lib/transactionsExport";

function txn(over: Partial<Transaction>): Transaction {
  return {
    project: "ALPHA", street: "S", district: "09", marketSegment: "CCR", propertyType: "Condominium",
    saleType: "New Sale", tenure: "99 yrs lease commencing from 2022", floorRange: "01-05", noOfUnits: 1, areaSqm: 100,
    price: 2_152_780, psf: 2000, month: "2025-04", ...over,
  };
}

const all = [
  txn({ month: "2025-04", psf: 1800, price: 1_937_502 }),
  txn({ month: "2026-05" }),
  txn({ month: "2026-06", saleType: "Resale", psf: 2600, price: 2_798_614 }),
  txn({ project: "BETA", saleType: "Resale", tenure: "Freehold", district: "10" }),
];
const input: ComparablesInput = {
  projects: ["BETA", "ALPHA"],
  allRows: all,
  periodRows: all.filter((r) => r.month >= "2026-01"),
  period: { from: "2026-01", to: "2026-09", latest: "2026-09" },
  pipeline: [{ project: "Alpha", district: "09", totalUnits: 4, expectedTOPYear: "na", developerName: "Dev Co" }],
  mrtByProject: new Map([["ALPHA", "250m to Orchard MRT"]]),
  subject: { name: "Orchard Boulevard", district: "10", mrt: "390m to Orchard Boulevard MRT", tenure: "99 years" },
};

describe("comparableRows", () => {
  const rows = comparableRows(input);

  it("keeps the selection order", () => expect(rows.map((r) => r.project)).toEqual(["BETA", "ALPHA"]));

  it("fills since-launch figures from developer sales and the pipeline", () => {
    const a = rows[1];
    expect(a).toMatchObject({ district: "09", mrt: "250m to Orchard MRT", tenure: "99 years", completion: "Uncompleted", totalUnits: 4, developer: "Dev Co" });
    expect(a.launch?.toISOString().slice(0, 10)).toBe("2025-04-01");
    expect(a.soldByDeveloperPct).toBe(0.5); // 2 new-sale units of 4
    expect(a.sinceLaunch?.caveats).toBe(2);
    expect(a.inPeriod?.caveats).toBe(2); // May and Jun 2026, any sale type
  });

  it("takes total units from the developer survey over the pipeline (which may add serviced residences)", () => {
    const [, a] = comparableRows({
      ...input,
      pipeline: [{ ...input.pipeline[0], totalUnits: 8 }],
      developerSales: [{ project: "ALPHA", unitsAvail: 4, launchedToDate: 4, soldToDate: 2, refPeriod: "0926" }],
    });
    expect(a).toMatchObject({ totalUnits: 4, soldByDeveloperPct: 0.5 });
  });

  it("marks projects outside the pipeline as completed, with no developer sales", () => {
    expect(rows[0]).toMatchObject({ completion: "Completed", developer: "-", tenure: "Freehold", sinceLaunch: undefined });
  });
});

describe("helpers", () => {
  it("shortens tenure", () => expect(shortTenure("999 yrs lease commencing from 1826")).toBe("999 years"));
  it("titles the period", () => {
    expect(periodTitle({ from: "2026-01", to: "2026-09", latest: "2026-09" })).toBe("Past 9 months transactions from 1 Jan 2026");
    expect(periodTitle({ from: "2026-01", to: "2026-03", latest: "2026-09" })).toBe("Transactions from Jan 2026 to Mar 2026");
  });
  it("names the file after the subject site", () => {
    expect(exportFileName("Orchard Boulevard", new Date("2026-10-19T08:00:00Z"))).toBe("Orchard Boulevard - comparables 2026-10-19.xlsx");
  });
});

describe("buildComparablesWorkbook", () => {
  it("lays out the template's sheet", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildComparablesWorkbook(input)) as unknown as Parameters<typeof wb.xlsx.load>[0]);
    const ws = wb.getWorksheet("Comparable Resi Sales")!;
    expect(ws.getCell("T1").value).toBe("Past 9 months transactions from 1 Jan 2026");
    expect(ws.getCell("C2").value).toBe("Project Name");
    expect(ws.getCell("C3").value).toBe("ORCHARD BOULEVARD");
    expect(ws.getCell("C5").value).toBe("BETA");
    expect(ws.getCell("C6").value).toBe("ALPHA");
    expect(ws.getCell("J6").numFmt).toBe("0%");
    expect((ws.getCell("U6").value as ExcelJS.CellFormulaValue).formula).toBe("C6");
    expect(ws.getCell("B7").value).toMatch(/^\* Adjusted/);
    expect(ws.model.merges).toEqual(expect.arrayContaining(["O2:Q2", "AA2:AC2"]));
  });
});
