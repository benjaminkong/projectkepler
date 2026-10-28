import type { FastifyInstance } from "fastify";
import { aiConfigured } from "@tender/core/aiValuation";
import { getOrCreateAssessment, getStoredAssessment } from "@tender/core/assessmentStore";
import { buildSiteValuationInputs } from "@tender/core/siteValuation";
import { ASSUMPTIONS } from "@tender/core/valuation";
import { siteOr404 } from "./http";

type SlugParams = { Params: { slug: string } };
const AI_NOT_FOUND = { ok: false, error: "failed", message: "Site not found" };

export async function valuationRoutes(app: FastifyInstance) {
  /** GET /api/sites/:slug/valuation -> comparables + residual baseline (no AI, no cost). */
  app.get<SlugParams>("/api/sites/:slug/valuation", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply);
    if (!site) return reply;
    try {
      const inputs = await buildSiteValuationInputs(site);
      if (!inputs) return reply.code(422).send({ error: "Site location unknown" });
      return { ...inputs, assumptions: ASSUMPTIONS, aiEnabled: aiConfigured() };
    } catch (err) {
      req.log.error(err, "[valuation] failed");
      return reply.code(502).send({ error: "Could not load transactions from URA" });
    }
  });

  /** GET /api/sites/:slug/valuation/ai -> the stored assessment, or 404 if none (never calls the LLM). */
  app.get<SlugParams>("/api/sites/:slug/valuation/ai", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply, AI_NOT_FOUND);
    if (!site) return reply;
    const stored = await getStoredAssessment(site.slug);
    return stored
      ? { ...stored.result, stored: true }
      : reply.code(404).send({ ok: false, error: "failed", message: "No assessment stored yet" });
  });

  /**
   * POST /api/sites/:slug/valuation/ai -> the stored assessment if there is one, otherwise
   * generates one with Claude and stores it. `?refresh=1` regenerates and replaces it.
   */
  app.post<SlugParams & { Querystring: { refresh?: string } }>("/api/sites/:slug/valuation/ai", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply, AI_NOT_FOUND);
    if (!site) return reply;
    const refresh = req.query.refresh === "1";
    const result = await getOrCreateAssessment(site.slug, () => buildSiteValuationInputs(site), { refresh }).catch((err) => {
      req.log.error(err, "[ai-valuation] store/generate failed");
      return { ok: false as const, error: "failed" as const, message: "Could not load or save the assessment." };
    });
    return reply.code(result.ok ? 200 : result.error === "not_configured" ? 503 : 502).send(result);
  });
}
