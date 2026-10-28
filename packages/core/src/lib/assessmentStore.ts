// Stores one AI assessment per parcel, so Claude is called only when a parcel has none
// (or someone asks to regenerate it). Server-only.
//
// Backend: a JSON file per parcel under ASSESSMENT_STORE_DIR (default ./.data/ai-assessments).
// That suits local dev and Docker with a mounted volume. On Vercel only /tmp is writable, and it
// is per-instance and wiped on cold starts, so saved assessments there are best-effort until a
// database replaces this: implement AssessmentStore and change `defaultDeps` below.
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assessWithClaude, type AiResult } from "./aiValuation";
import type { SiteValuationInputs } from "./siteValuation";

type OkResult = Extract<AiResult, { ok: true }>;

export interface StoredAssessment {
  slug: string;
  siteName: string;
  storedAt: string;
  result: OkResult;
  /** What the assessment was based on, to judge whether it is out of date. */
  basis: {
    dataAsOf: string;
    baselineLandPsfPpr?: { low: number; base: number; high: number };
    baselineLaunchPsf?: { low: number; base: number; high: number };
  };
}

export interface AssessmentStore {
  get(slug: string): Promise<StoredAssessment | null>;
  put(record: StoredAssessment): Promise<void>;
}

const SLUG_RE = /^[a-z0-9-]+$/;

function defaultDir(): string {
  if (process.env.ASSESSMENT_STORE_DIR) return process.env.ASSESSMENT_STORE_DIR;
  // Vercel sets VERCEL=1; its project directory is read-only.
  return process.env.VERCEL ? path.join(os.tmpdir(), "ai-assessments") : path.join(process.cwd(), ".data", "ai-assessments");
}

export function fileStore(dir = defaultDir()): AssessmentStore {
  const file = (slug: string) => {
    if (!SLUG_RE.test(slug)) throw new Error(`Invalid slug: ${slug}`);
    return path.join(dir, `${slug}.json`);
  };
  return {
    async get(slug) {
      try {
        return JSON.parse(await readFile(file(slug), "utf8")) as StoredAssessment;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async put(record) {
      await mkdir(dir, { recursive: true });
      // Write then rename, so a reader never sees a half-written file.
      const target = file(record.slug);
      const tmp = `${target}.${process.pid}.tmp`;
      await writeFile(tmp, JSON.stringify(record, null, 1));
      await rename(tmp, target);
    },
  };
}

const defaultDeps = { store: fileStore(), generate: assessWithClaude };
type Deps = typeof defaultDeps;

// One generation per parcel at a time, shared by concurrent requests (each call costs money).
const g = globalThis as typeof globalThis & { __aiInFlight?: Map<string, Promise<AiResult>> };
const inFlight = (g.__aiInFlight ??= new Map());

/** The saved assessment, or null when there is none or the store can't be read. */
export async function getStoredAssessment(slug: string, { store } = defaultDeps): Promise<StoredAssessment | null> {
  try {
    return await store.get(slug);
  } catch (err) {
    console.error(`[ai-store] read failed for ${slug}:`, err);
    return null;
  }
}

/**
 * Returns the stored assessment for a parcel, or generates one with Claude and stores it.
 * `refresh: true` regenerates even when one is stored. Failures are returned, not stored.
 */
export async function getOrCreateAssessment(
  slug: string,
  loadInputs: () => Promise<SiteValuationInputs | null>,
  opts: { refresh?: boolean } = {},
  deps: Deps = defaultDeps,
): Promise<AiResult> {
  if (!opts.refresh) {
    const existing = await getStoredAssessment(slug, deps);
    if (existing) return { ...existing.result, stored: true };
  }

  const running = inFlight.get(slug);
  if (running) return running;

  const job = (async (): Promise<AiResult> => {
    const inputs = await loadInputs();
    if (!inputs?.valuation) {
      return { ok: false, error: "failed", message: "Not enough nearby transactions to assess." };
    }
    const result = await deps.generate(inputs);
    if (!result.ok) return result;
    // A failed save must not hide an assessment we already paid for: log it and still return it.
    try {
      await deps.store.put({
        slug,
        siteName: inputs.site.name,
        storedAt: new Date().toISOString(),
        result,
        basis: {
          dataAsOf: inputs.dataAsOf,
          baselineLandPsfPpr: inputs.valuation.landPsfPpr,
          baselineLaunchPsf: inputs.valuation.launchPsf,
        },
      });
    } catch (err) {
      console.error(`[ai-store] save failed for ${slug}; returning the unsaved assessment:`, err);
    }
    return result;
  })().finally(() => inFlight.delete(slug));

  inFlight.set(slug, job);
  return job;
}
