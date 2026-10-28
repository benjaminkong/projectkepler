import { describe, expect, it } from "vitest";
import { buildDiagram, LINES, nearestStations } from "@/lib/mrtLines";

const orchardBoulevardParcel = { lat: 1.30395, lng: 103.8264 };

describe("LINES", () => {
  it("orders stations by code and joins branches to their parent station", () => {
    const ew = LINES.find((l) => l.id === "EW")!;
    expect(ew.stops.slice(0, 3).map((s) => s.name)).toEqual(["Pasir Ris", "Tampines", "Simei"]);
    const cg = LINES.find((l) => l.id === "CG")!;
    expect(cg.stops.map((s) => s.name)).toEqual(["Tanah Merah", "Expo", "Changi Airport"]);
  });

  it("lists every code at an interchange", () => {
    const dhoby = LINES.find((l) => l.id === "NS")!.stops.find((s) => s.name === "Dhoby Ghaut")!;
    expect(dhoby.codes.map((c) => c.code)).toEqual(["CC1", "NE6", "NS24"]);
  });
});

describe("nearestStations + buildDiagram", () => {
  const nearby = nearestStations(orchardBoulevardParcel, 3);

  it("finds the 3 closest stations", () => {
    expect(nearby.map((s) => s.name)).toEqual(["Orchard Boulevard", "Orchard", "Napier"]);
    expect(nearby[0].distanceM).toBeLessThan(400);
  });

  it("builds one row per line with 5 stations beyond the outermost stars", () => {
    const rows = buildDiagram(nearby);
    const te = rows.find((r) => r.line.id === "TE")!;
    const starred = te.stops.filter((s) => s.starred).map((s) => s.name);
    expect(starred).toEqual(["Napier", "Orchard Boulevard", "Orchard"]);
    const first = te.stops.findIndex((s) => s.starred);
    const last = te.stops.length - 1 - [...te.stops].reverse().findIndex((s) => s.starred);
    expect(first).toBe(5);
    expect(te.stops.length - 1 - last).toBe(5);
    expect(te.stops[0].stopsAway).toBe(5);

    const ns = rows.find((r) => r.line.id === "NS")!;
    expect(ns.stops.map((s) => s.name)).toContain("Orchard");
    expect(ns.stops).toHaveLength(11);
  });
});
