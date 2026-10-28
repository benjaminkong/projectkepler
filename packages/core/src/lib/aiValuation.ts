// AI-assisted land price assessment with Claude. The model does not invent a price from
// scratch: it receives the comparables and the residual baseline (valuation.ts) and adjusts
// them for location factors, returning its answer through a `submit_assessment` tool call
// whose input we validate before showing.
//
// Providers (server-side env, first match wins):
//  - Amazon Bedrock: AWS_BEARER_TOKEN_BEDROCK (+ BEDROCK_REGION, default us-east-1; optional BEDROCK_MODEL)
//  - Anthropic API:  ANTHROPIC_API_KEY
// Server-only.
import Anthropic from "@anthropic-ai/sdk";
import type { SiteValuationInputs } from "./siteValuation";
import { ASSUMPTIONS } from "./valuation";

const TOOL_NAME = "submit_assessment";

type Provider =
  | { kind: "bedrock"; client: Anthropic; model: string }
  | { kind: "anthropic"; client: Anthropic; model: string };

/** Which Claude endpoint to use, from the environment. Null when none is configured. */
function provider(): Provider | null {
  const bedrockToken = process.env.AWS_BEARER_TOKEN_BEDROCK;
  if (bedrockToken) {
    const region = process.env.BEDROCK_REGION || process.env.AWS_REGION || "us-east-1";
    // Claude in Amazon Bedrock serves the Messages API; a Bedrock API key works as a bearer
    // token with the standard client pointed at the bedrock-mantle endpoint.
    return {
      kind: "bedrock",
      client: new Anthropic({ apiKey: bedrockToken, baseURL: `https://bedrock-mantle.${region}.api.aws/anthropic` }),
      model: process.env.BEDROCK_MODEL || "anthropic.claude-opus-5-5",
    };
  }
  if (process.env.ANTHROPIC_API_KEY) {
    return { kind: "anthropic", client: new Anthropic(), model: "claude-opus-5-5" };
  }
  return null;
}

export const aiConfigured = () =>
  Boolean(process.env.AWS_BEARER_TOKEN_BEDROCK || process.env.ANTHROPIC_API_KEY);

export interface AiRange {
  low: number;
  base: number;
  high: number;
}

export interface AiAssessment {
  summary: string;
  launch_psf: AiRange;
  land_psf_ppr: AiRange;
  confidence: "low" | "medium" | "high";
  drivers: { factor: string; effect: "positive" | "negative" | "neutral"; impact_pct: number; reason: string }[];
  risks: string[];
}

export type AiResult =
  | {
      ok: true;
      assessment: AiAssessment;
      model: string;
      provider: "bedrock" | "anthropic";
      generatedAt: string;
      /** Tokens billed for the generation (thinking counts as output). */
      usage?: { inputTokens: number; outputTokens: number };
      /** Set when served from the assessment store rather than generated for this request. */
      stored?: boolean;
    }
  | { ok: false; error: "not_configured" | "refused" | "failed"; message: string };

const range = {
  type: "object",
  properties: { low: { type: "integer" }, base: { type: "integer" }, high: { type: "integer" } },
  required: ["low", "base", "high"],
  additionalProperties: false,
};

const SCHEMA = {
  type: "object",
  properties: {
    summary: { type: "string", description: "2-3 sentences: the land price view and the main reason for it." },
    launch_psf: { ...range, description: "Expected new-launch selling price, SGD per sq ft of saleable area." },
    land_psf_ppr: { ...range, description: "Indicative land price, SGD per sq ft per plot ratio (per sq ft of GFA)." },
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    drivers: {
      type: "array",
      description: "The factors behind any adjustment to the baseline, largest first.",
      items: {
        type: "object",
        properties: {
          factor: { type: "string" },
          effect: { type: "string", enum: ["positive", "negative", "neutral"] },
          impact_pct: { type: "number", description: "Approximate effect on the base land price, in percent." },
          reason: { type: "string" },
        },
        required: ["factor", "effect", "impact_pct", "reason"],
        additionalProperties: false,
      },
    },
    risks: { type: "array", items: { type: "string" } },
  },
  required: ["summary", "launch_psf", "land_psf_ppr", "confidence", "drivers", "risks"],
  additionalProperties: false,
};

const SYSTEM = `You are a Singapore residential land valuation analyst helping a property developer prepare a bid for a Government Land Sales (GLS) tender site.

You receive JSON with the site's planning parameters, its distance to MRT stations, primary schools, shopping malls, hawker centres and parks, recent private home transactions nearby (from URA caveats), and a baseline residual land value calculated from those transactions with stated assumptions.

Produce an indicative land price as a range in SGD per square foot per plot ratio (psf ppr), plus the expected new-launch price in SGD psf.
- Start from the baseline and the comparables. Adjust only for reasons you can tie to the data provided: transit access, primary schools within 1 km (Primary 1 priority), malls and amenities, tenure, market segment, price trend, site size and unit count, and any planning conditions in the remarks.
- Do not invent transactions, past GLS bids or policy facts that are not in the input. If the data is thin or the site is mixed-use (e.g. a white site with office or retail quanta), say so and lower your confidence.
- Keep low <= base <= high. Use whole dollars.`;

function isAssessment(x: unknown): x is AiAssessment {
  const a = x as AiAssessment;
  const ok = (r: AiRange) => r && [r.low, r.base, r.high].every(Number.isFinite) && r.low <= r.base && r.base <= r.high;
  return Boolean(a && typeof a.summary === "string" && ok(a.launch_psf) && ok(a.land_psf_ppr) && Array.isArray(a.drivers));
}

/** Generates a fresh assessment with Claude (one paid call). Use getOrCreateAssessment() to reuse stored ones. */
export async function assessWithClaude(inputs: SiteValuationInputs): Promise<AiResult> {
  const p = provider();
  if (!p) {
    return {
      ok: false,
      error: "not_configured",
      message: "Set AWS_BEARER_TOKEN_BEDROCK (Amazon Bedrock) or ANTHROPIC_API_KEY on the server to enable AI assessments.",
    };
  }
  const payload = {
    site: inputs.site,
    nearestMrtStations: inputs.stations.map((s) => ({
      name: s.name,
      lines: s.codes.map((c) => c.code),
      walkingDistanceM: s.walkM,
      straightLineDistanceM: Math.round(s.distanceM),
    })),
    amenities: inputs.amenities,
    comparables: inputs.valuation && {
      ...inputs.valuation,
      projects: inputs.valuation.projects.slice(0, 15),
    },
    baselineAssumptions: ASSUMPTIONS,
  };

  const tool = {
    name: TOOL_NAME,
    description: "Submit the land price assessment for this site. Call it exactly once, with your final numbers.",
    input_schema: SCHEMA as Anthropic.Tool.InputSchema,
  };
  const messages: Anthropic.MessageParam[] = [
    {
      role: "user",
      content: `Assess this tender site, then call ${TOOL_NAME} with your assessment.\n\n${JSON.stringify(payload, null, 1)}`,
    },
  ];

  try {
    // Forced tool_choice is not available on Claude Opus 5.5, so the prompt asks for the call.
    const response =
      p.kind === "anthropic"
        ? await p.client.beta.messages.create({
            model: p.model,
            max_tokens: 16000,
            // On a safety-classifier decline, retry server-side on Anthropic's recommended fallback model.
            betas: ["server-side-fallback-2026-07-01"],
            fallbacks: "default",
            output_config: { effort: "high" },
            system: SYSTEM,
            tools: [{ ...tool, strict: true }],
            tool_choice: { type: "auto" },
            messages,
          })
        : // Bedrock: no server-side fallbacks or structured outputs; tool use and effort are supported.
          await p.client.messages.create({
            model: p.model,
            max_tokens: 16000,
            output_config: { effort: "high" },
            system: SYSTEM,
            tools: [tool],
            tool_choice: { type: "auto" },
            messages,
          });

    if (response.stop_reason === "refusal") {
      return { ok: false, error: "refused", message: "The model declined this request." };
    }
    const call = response.content.find((b) => b.type === "tool_use" && b.name === TOOL_NAME);
    const parsed: unknown = call && "input" in call ? call.input : null;
    if (!isAssessment(parsed)) {
      return { ok: false, error: "failed", message: "The model returned an incomplete assessment." };
    }
    const usage = { inputTokens: response.usage.input_tokens, outputTokens: response.usage.output_tokens };
    console.log(`[ai-valuation] ${inputs.site.slug}: ${usage.inputTokens} input + ${usage.outputTokens} output tokens (${p.kind})`);
    return { ok: true, assessment: parsed, model: response.model, provider: p.kind, generatedAt: new Date().toISOString(), usage };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) {
      return { ok: false, error: "not_configured", message: `The ${p.kind === "bedrock" ? "Bedrock" : "Anthropic"} API key was rejected.` };
    }
    if (err instanceof Anthropic.RateLimitError) {
      return { ok: false, error: "failed", message: "Rate limited by the Anthropic API. Try again shortly." };
    }
    if (err instanceof Anthropic.NotFoundError) {
      return { ok: false, error: "failed", message: `Model ${p.model} is not enabled for this account or region.` };
    }
    if (err instanceof Anthropic.APIError) {
      console.error("[ai-valuation] API error", p.kind, err.status, err.message);
      return { ok: false, error: "failed", message: `${p.kind === "bedrock" ? "Bedrock" : "Anthropic"} API error ${err.status ?? ""}`.trim() };
    }
    console.error("[ai-valuation] failed", err);
    return { ok: false, error: "failed", message: "The AI assessment failed." };
  }
}
