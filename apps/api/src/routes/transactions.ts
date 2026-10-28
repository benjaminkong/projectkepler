import type { FastifyInstance } from "fastify";
import { haversineMeters, type LatLng } from "@tender/core/geo";
import { mrtWalkLabel, nearestStationsByWalking } from "@tender/core/mrtLines";
import {
  DISTRICTS,
  filterTransactions,
  filtersFromQuery,
  getDeveloperSales,
  getPipeline,
  getTransactions,
  listProjects,
  median,
} from "@tender/core/transactions";
import { buildComparablesWorkbook, exportFileName, type SubjectSite } from "@tender/core/transactionsExport";
import { geocodeName, getTenderSite, getTenderSites } from "@tender/core/ura";
import { monthsBefore } from "@tender/core/valuation";
import { queryAll, queryOne, type Query } from "./http";

const PAGE_SIZE = 50;
/** Default comparables period when no "Date from" is set, as in the template. */
const DEFAULT_MONTHS = 9;

function mostCommon(values: string[]): string | undefined {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0];
}

export async function transactionRoutes(app: FastifyInstance) {
  /** GET /api/transactions/meta -> districts and current tender sites (for the filter form). Never loads URA data. */
  app.get("/api/transactions/meta", async () => {
    // Tender sites for the export's subject row (cached list; the form still works without it).
    const sites = await getTenderSites()
      .then((l) => l.sites.map((s) => ({ slug: s.slug, name: s.name })))
      .catch(() => []);
    return { districts: DISTRICTS, sites };
  });

  /**
   * GET /api/transactions?district=&project=&priceFrom=&priceTo=&dateFrom=&dateTo=&page=
   * -> one page of matching rows (newest first) plus summary stats.
   */
  app.get<{ Querystring: Query }>("/api/transactions", async (req, reply) => {
    const filters = filtersFromQuery((k) => queryAll(req.query, k));
    let data: Awaited<ReturnType<typeof getTransactions>>;
    try {
      data = await getTransactions();
    } catch (err) {
      req.log.error(err, "[transactions] load failed");
      return reply.code(502).send({ error: "We couldn't load transactions from URA right now. Please try again in a few minutes." });
    }
    const matches = filterTransactions(data.rows, filters);
    const pages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    const page = Math.min(Math.max(1, Number(queryOne(req.query, "page")) || 1), pages);
    return {
      total: matches.length,
      page,
      pages,
      pageSize: PAGE_SIZE,
      rows: matches.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
      stats: {
        medianPrice: median(matches.map((r) => r.price)),
        medianPsf: median(matches.map((r) => r.psf)),
        // reduce, not Math.max(...): spreading ~130k values overflows the call stack
        highestPrice: matches.length ? matches.reduce((m, r) => Math.max(m, r.price), 0) : undefined,
      },
      earliestMonth: data.rows.at(-1)?.month,
      latestMonth: data.rows[0]?.month,
      loadedAt: data.loadedAt,
    };
  });

  /** GET /api/transactions/projects?district=09&district=10 -> { projects: string[] } */
  app.get<{ Querystring: Query }>("/api/transactions/projects", async (req, reply) => {
    const districts = queryAll(req.query, "district").filter((d) => DISTRICTS[d]);
    try {
      const { rows } = await getTransactions();
      return { projects: listProjects(rows, districts) };
    } catch (err) {
      req.log.error(err, "[transactions] project list failed");
      return reply.code(502).send({ error: "Could not load projects from URA" });
    }
  });

  /**
   * GET /api/transactions/export?project=...&project=...&subject=<tender-site-slug>&dateFrom=&dateTo=&priceFrom=&priceTo=
   * -> "<Subject> - comparables <date>.xlsx" in the team's comparables layout.
   * At least one project is required (the button is disabled until one is chosen).
   */
  app.get<{ Querystring: Query }>("/api/transactions/export", async (req, reply) => {
    const filters = filtersFromQuery((k) => queryAll(req.query, k));
    const projects = filters.projects ?? [];
    if (projects.length === 0) return reply.code(400).send({ error: "Select at least one project to export." });

    try {
      const [{ rows }, pipeline, developerSales] = await Promise.all([
        getTransactions(),
        getPipeline().catch(() => []),
        getDeveloperSales().catch(() => []),
      ]);
      const latest = rows[0]?.month ?? new Date().toISOString().slice(0, 7);
      const period = { from: filters.dateFrom ?? monthsBefore(latest, DEFAULT_MONTHS - 1), to: filters.dateTo ?? latest, latest };
      const periodRows = filterTransactions(rows, {
        projects,
        priceFrom: filters.priceFrom,
        priceTo: filters.priceTo,
        dateFrom: period.from,
        dateTo: period.to,
      });

      // Walking distance from each project to its nearest MRT/LRT station. URA gives coordinates
      // for most projects; new launches often have none yet, so look those up in OneMap by
      // project name, then by street (one at a time: OneMap rate-limits bursts).
      const locations = new Map<string, LatLng>();
      const streets = new Map<string, string>();
      for (const r of rows) {
        if (!projects.includes(r.project)) continue;
        if (!streets.has(r.project)) streets.set(r.project, r.street);
        if (r.lat !== undefined && r.lng !== undefined && !locations.has(r.project)) locations.set(r.project, { lat: r.lat, lng: r.lng });
      }
      for (const p of projects) {
        if (locations.has(p)) continue;
        const found = (await geocodeName(p)) ?? (streets.get(p) ? await geocodeName(streets.get(p)!) : null);
        if (found) locations.set(p, found);
        await new Promise((r) => setTimeout(r, 300));
      }
      const mrtByProject = new Map(
        await Promise.all(
          projects.map(async (p): Promise<[string, string]> => {
            const at = locations.get(p);
            return [p, at ? mrtWalkLabel(await nearestStationsByWalking(at, 2)) : "-"];
          }),
        ),
      );

      // Optional subject site (a current tender site).
      let subject: SubjectSite | undefined;
      const subjectSlug = queryOne(req.query, "subject");
      const site = subjectSlug ? await getTenderSite(subjectSlug) : null;
      if (site?.center) {
        const center = site.center;
        const nearbyDistricts = rows
          .filter((r) => r.lat !== undefined && haversineMeters(center, { lat: r.lat, lng: r.lng! }) <= 500)
          .map((r) => r.district);
        subject = {
          name: site.name,
          district: mostCommon(nearbyDistricts) ?? "-",
          mrt: mrtWalkLabel(await nearestStationsByWalking(center, 2)),
          tenure: site.facts.leaseYears ? `${site.facts.leaseYears} years` : "-",
        };
      }

      const file = await buildComparablesWorkbook({ projects, allRows: rows, periodRows, period, pipeline, developerSales, mrtByProject, subject });
      return reply
        .header("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("Content-Disposition", `attachment; filename="${exportFileName(site?.name)}"`)
        .header("Cache-Control", "no-store")
        .send(Buffer.from(file));
    } catch (err) {
      req.log.error(err, "[transactions] export failed");
      return reply.code(502).send({ error: "Could not build the Excel file. Try again shortly." });
    }
  });
}
