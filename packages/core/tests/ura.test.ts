import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { daysUntil, parseSiteListHtml, parseSubmissionDate } from "@/lib/ura";

const html = readFileSync(path.join(__dirname, "fixtures/ura-sites-for-tender.html"), "utf8");

describe("parseSiteListHtml", () => {
  const { sites, uraLastUpdated } = parseSiteListHtml(html);

  it("finds every site card on the URA page", () => {
    expect(sites.map((s) => s.slug)).toEqual([
      "orchard-boulevard-aug26",
      "town-hall-link-jul26",
      "east-coast-road-sep26",
    ]);
  });

  it("reads name, type and tender date", () => {
    expect(sites[0]).toMatchObject({
      name: "Orchard Boulevard",
      developmentType: "Residential development",
      tenderSubmissionText: "29 October 2026, 9.00 am - 12.00 pm",
      tenderCloseDate: "2026-10-29",
    });
    expect(sites[1].developmentType).toBe("White site development");
  });

  it("reads the last-updated date", () => {
    expect(uraLastUpdated).toBe("15 October 2026");
  });
});

describe("dates", () => {
  it("parses URA submission text", () => {
    expect(parseSubmissionDate("3 December 2026, 9.00 am - 12.00 pm")).toBe("2026-12-03");
  });

  it("counts days in Singapore time", () => {
    // 16 Oct 2026 20:00 UTC is already 17 Oct in Singapore
    expect(daysUntil("2026-10-29", new Date("2026-10-16T20:00:00Z"))).toBe(12);
  });
});

import { estimatedLaunch, parseGlsSitesHtml, siteSlug, statusKey, statusLabel } from "@/lib/ura";

describe("parseGlsSitesHtml (Current URA GLS Sites)", () => {
  const gls = parseGlsSitesHtml(readFileSync(path.join(__dirname, "fixtures/ura-current-gls-sites.html"), "utf8"));

  it("reads the 14 Confirmed List sites and ignores the Reserve List", () => {
    expect(gls.rows).toHaveLength(14);
    expect(gls.rows.map((r) => r.name)).not.toContain("Cross Street");
  });

  it("reads name, site id, category, area, plot ratio and status", () => {
    expect(gls.rows.find((r) => r.name === "Marina Gardens Lane")).toEqual({
      siteId: 1060,
      name: "Marina Gardens Lane",
      category: "Residential Sites",
      siteAreaHa: 0.6,
      grossPlotRatio: 5.6,
      status: "Tender closed",
    });
    expect(gls.rows.find((r) => r.siteId === 1100)).toMatchObject({ name: "Town Hall Link", category: "White Sites" });
    expect(gls.uraLastUpdated).toBe("15 October 2026");
  });

  it("counts statuses as on the page", () => {
    const keys = gls.rows.map((r) => statusKey(r.status));
    expect(keys.filter((k) => k === "open")).toHaveLength(3);
    expect(keys.filter((k) => k === "closed")).toHaveLength(1);
    expect(keys.filter((k) => k === "awarded")).toHaveLength(6);
    expect(keys.filter((k) => k === "upcoming")).toHaveLength(4);
  });
});

describe("status and slug helpers", () => {
  it("normalises URA's status text", () => {
    expect(statusKey("Open for Tender")).toBe("open");
    expect(statusLabel("Open for Tender")).toBe("Open for tender");
    expect(statusLabel("Nov-2026 *")).toBe("Est. launch Nov 2026");
    expect(estimatedLaunch("Dec-2026 *")).toBe("Dec 2026");
    expect(estimatedLaunch("Awarded")).toBeUndefined();
  });
  it("uses URA's page name as the slug, else name + site id", () => {
    expect(siteSlug("https://www.ura.gov.sg/land-sales/sites-for-tender/marina-gardens-lane-aug26", "Marina Gardens Lane", 1060)).toBe("marina-gardens-lane-aug26");
    expect(siteSlug(undefined, "Plymouth Avenue/Dunearn Road", 1110)).toBe("plymouth-avenue-dunearn-road-1110");
  });
});
