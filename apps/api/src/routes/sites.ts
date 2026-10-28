import type { FastifyInstance } from "fastify";
import { nearestStationsByWalking } from "@tender/core/mrtLines";
import { findAllNearby, withWalkingDistances } from "@tender/core/nearby";
import { getTenderSites } from "@tender/core/ura";
import { siteOr404 } from "./http";

type SlugParams = { Params: { slug: string } };

export async function siteRoutes(app: FastifyInstance) {
  /**
   * GET /api/sites -> { sites, uraLastUpdated, fetchedAt }. Each site carries the nearest MRT
   * stations and primary schools in straight line (routing walks for every card would be slow).
   */
  app.get("/api/sites", async () => {
    const list = await getTenderSites();
    return {
      ...list,
      sites: list.sites.map((site) => {
        const nearby = site.center ? findAllNearby(site.center) : null;
        return { ...site, nearby: nearby ? { mrt: nearby.mrt, primary_school: nearby.primary_school } : null };
      }),
    };
  });

  /**
   * GET /api/sites/:slug -> { site, nearby } with walking distances to every nearby place.
   * `?nearby=0` skips the nearby places (and the walking-route lookups) when only the site is needed.
   */
  app.get<SlugParams & { Querystring: { nearby?: string } }>("/api/sites/:slug", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply);
    if (!site) return reply;
    if (req.query.nearby === "0") return { site, nearby: null };
    const nearby = site.center ? await withWalkingDistances(site.center, findAllNearby(site.center)) : null;
    return { site, nearby };
  });

  /** GET /api/sites/:slug/mrt -> the 3 stations nearest on foot, for the line diagrams. */
  app.get<SlugParams>("/api/sites/:slug/mrt", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply);
    if (!site) return reply;
    const nearby = site.center ? await nearestStationsByWalking(site.center, 3) : [];
    return { site: { slug: site.slug, name: site.name }, nearby };
  });
}
