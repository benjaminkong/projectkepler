import { mkdtemp, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { AiResult } from "@/lib/aiValuation";
import { fileStore, getOrCreateAssessment, type AssessmentStore, type StoredAssessment } from "@/lib/assessmentStore";
import type { SiteValuationInputs } from "@/lib/siteValuation";

const range = { low: 1, base: 2, high: 3 };
const okResult: AiResult = {
  ok: true,
  model: "claude-opus-5-5",
  provider: "bedrock",
  generatedAt: "2026-10-17T00:00:00.000Z",
  assessment: { summary: "s", launch_psf: range, land_psf_ppr: range, confidence: "medium", drivers: [], risks: [] },
};
const inputs = {
  site: { slug: "x", name: "X" },
  valuation: { landPsfPpr: range, launchPsf: { ...range, basis: "new sales" } },
  dataAsOf: "2026-10-17",
} as unknown as SiteValuationInputs;

function memoryStore(over: Partial<AssessmentStore> = {}) {
  const saved = new Map<string, StoredAssessment>();
  const store: AssessmentStore = {
    get: async (slug) => saved.get(slug) ?? null,
    put: async (r) => void saved.set(r.slug, r),
    ...over,
  };
  return { store, saved };
}

describe("getOrCreateAssessment", () => {
  it("generates once, then serves the saved copy", async () => {
    const { store } = memoryStore();
    const generate = vi.fn(async () => okResult);
    const first = await getOrCreateAssessment("a", async () => inputs, {}, { store, generate });
    const second = await getOrCreateAssessment("a", async () => inputs, {}, { store, generate });
    expect(first.ok && first.stored).toBeFalsy();
    expect(second.ok && second.stored).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("still returns the assessment when saving fails (e.g. read-only disk)", async () => {
    const { store } = memoryStore({ put: async () => Promise.reject(new Error("EROFS: read-only file system")) });
    const result = await getOrCreateAssessment("b", async () => inputs, {}, { store, generate: async () => okResult });
    expect(result.ok).toBe(true);
  });

  it("treats an unreadable store as empty and generates", async () => {
    const { store } = memoryStore({ get: async () => Promise.reject(new Error("EACCES")) });
    const generate = vi.fn(async () => okResult);
    const result = await getOrCreateAssessment("c", async () => inputs, {}, { store, generate });
    expect(result.ok).toBe(true);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it("does not save failed generations", async () => {
    const { store, saved } = memoryStore();
    const failed: AiResult = { ok: false, error: "failed", message: "nope" };
    await getOrCreateAssessment("d", async () => inputs, {}, { store, generate: async () => failed });
    expect(saved.size).toBe(0);
  });

  it("shares one generation between simultaneous requests", async () => {
    const { store } = memoryStore();
    const generate = vi.fn(async () => okResult);
    await Promise.all([1, 2, 3].map(() => getOrCreateAssessment("e", async () => inputs, {}, { store, generate })));
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe("fileStore", () => {
  it("round-trips a record and rejects unsafe slugs", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "assess-"));
    const store = fileStore(dir);
    const record = { slug: "site-1", siteName: "S", storedAt: "t", result: okResult, basis: { dataAsOf: "d" } } as StoredAssessment;
    await store.put(record);
    expect(await store.get("site-1")).toEqual(record);
    expect(await store.get("missing")).toBeNull();
    expect(await readdir(dir)).toEqual(["site-1.json"]);
    await expect(store.get("../etc/passwd")).rejects.toThrow("Invalid slug");
  });
});
