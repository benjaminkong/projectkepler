<script setup lang="ts">
import { computed, ref } from "vue";
import { formatDistance } from "@tender/core/geo";
import type { SiteValuationInputs } from "@tender/core/siteValuation";
import type { ASSUMPTIONS } from "@tender/core/valuation";
import { api } from "../lib/api";
import { fmtMonth } from "../lib/format";
import { millions, psf } from "../lib/money";
import AiPanel from "./AiPanel.vue";
import RangeTile from "./RangeTile.vue";

type Baseline = SiteValuationInputs & { assumptions: typeof ASSUMPTIONS; aiEnabled: boolean };

const props = defineProps<{ slug: string }>();
const nf = new Intl.NumberFormat("en-SG");

/** Indicative land price for the site: comparables + residual baseline, with an optional AI review. */
const data = ref<Baseline | null>(null);
const error = ref<string | null>(null);
api<Baseline>(`/api/sites/${props.slug}/valuation`)
  .then((d) => (data.value = d))
  .catch((e: Error) => (error.value = e.message));

const v = computed(() => data.value?.valuation);
const a = computed(() => data.value?.assumptions);
const chips = computed(() =>
  (["mrt", "primary_school", "mall"] as const)
    .map((c) => data.value?.amenities.find((x) => x.category === c))
    .filter((x) => x !== undefined),
);
const pct = (n: number) => Math.round(n * 1000) / 10;
</script>

<template>
  <section class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5" aria-labelledby="price-estimate">
    <div class="mb-4 flex flex-wrap items-center justify-between gap-2">
      <h2 id="price-estimate" class="text-lg font-semibold">Price estimate</h2>
      <span class="rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-400/15 dark:text-amber-200">
        Indicative only, not a valuation
      </span>
    </div>

    <p v-if="error" class="text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <p v-else-if="!data" class="animate-pulse text-sm text-[var(--muted)]">
      Analysing nearby transactions… (the first load takes a few seconds)
    </p>
    <p v-else-if="!v" class="text-sm text-[var(--muted)]">Not enough comparable transactions within 2 km to estimate a price.</p>

    <div v-else-if="a" class="space-y-5">
      <div class="grid gap-3 sm:grid-cols-3">
        <RangeTile label="Expected launch price" unit="psf" :range="v.launchPsf" :fmt="psf" />
        <RangeTile label="Indicative land price" unit="psf ppr" :range="v.landPsfPpr" :fmt="psf" />
        <RangeTile
          v-if="v.totalLandPrice"
          :label="v.residentialGfaOnly ? 'Total land price (residential GFA only)' : 'Indicative total land price'"
          unit=""
          :range="v.totalLandPrice"
          :fmt="millions"
        />
      </div>

      <p class="text-sm text-[var(--muted)]">
        Launch price from {{ v.launchPsf.basis }} of {{ v.propertyTypes.join(" / ").toLowerCase() }} within {{ v.radiusM / 1000 }} km
        since {{ fmtMonth(v.fromMonth) }}: {{ v.newSale?.count ?? 0 }} new sales, {{ v.resale?.count ?? 0 }} resales and sub-sales.
        <template v-if="v.trend">
          Median $psf {{ v.trend.changePct >= 0 ? "up" : "down" }} {{ Math.abs(v.trend.changePct) }}% in the last 6 months vs the
          18 months before.
        </template>
        Land price is the residual after construction, fees, finance, marketing and a {{ pct(a.profitPct) }}% developer
        margin{{ v.gfaSqft ? `, on ${nf.format(v.gfaSqft)} sq ft of ${v.residentialGfaOnly ? "residential " : ""}GFA` : "" }}.
        <template v-if="v.residentialGfaOnly">The office and retail components of this mixed-use site are not valued.</template>
      </p>

      <div class="flex flex-wrap gap-2 text-xs">
        <span v-for="c in chips" :key="c.category" class="rounded-full border border-[var(--border)] px-2.5 py-1">
          {{ c.label }}: {{ c.count }} within {{ c.radiusM / 1000 }} km{{
            c.nearest ? ` · nearest ${formatDistance(c.nearest.distanceM)} ${c.nearest.walking ? "walk" : "direct"}` : ""
          }}
        </span>
      </div>

      <div class="overflow-x-auto">
        <table class="w-full min-w-[640px] text-sm">
          <caption class="mb-2 text-left text-sm font-semibold">Nearest comparable projects</caption>
          <thead class="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th class="py-2 pr-3 font-medium">Project</th>
              <th class="py-2 pr-3 text-right font-medium">Distance</th>
              <th class="py-2 pr-3 text-right font-medium">Transactions</th>
              <th class="py-2 pr-3 text-right font-medium">Median $psf</th>
              <th class="py-2 pr-3 font-medium">Latest</th>
              <th class="py-2 font-medium">Sale types</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in v.projects.slice(0, 8)" :key="p.project" class="border-b border-[var(--border)] last:border-b-0">
              <td class="py-1.5 pr-3">
                <span class="font-medium">{{ p.project }}</span>
                <span class="block text-xs text-[var(--muted)]">{{ p.tenure }}</span>
              </td>
              <td class="py-1.5 pr-3 text-right tabular-nums">{{ formatDistance(p.distanceM) }}</td>
              <td class="py-1.5 pr-3 text-right tabular-nums">{{ p.transactions }}</td>
              <td class="py-1.5 pr-3 text-right tabular-nums">{{ psf(p.medianPsf) }}</td>
              <td class="py-1.5 pr-3">{{ fmtMonth(p.latestMonth) }}</td>
              <td class="py-1.5 text-xs">{{ p.saleTypes.join(", ") }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <details class="text-sm">
        <summary class="cursor-pointer font-medium">Model assumptions</summary>
        <ul class="mt-2 grid gap-x-6 gap-y-1 text-[var(--muted)] sm:grid-cols-2">
          <li>Construction: ${{ a.constructionPsf }} psf of GFA + {{ pct(a.professionalFeesPct) }}% fees</li>
          <li>Developer margin: {{ pct(a.profitPct) }}% of sales</li>
          <li>Marketing: {{ pct(a.marketingPct) }}% · finance: {{ pct(a.financePct) }}% of sales</li>
          <li>Stamp duty and legal: {{ pct(a.landCostsPct) }}% of land price</li>
          <li>New-launch premium over resale (when few new sales): {{ pct(a.newLaunchPremium) }}%</li>
          <li>Comparables: last {{ a.lookbackMonths }} months, 1 km (2 km if under {{ a.minComparables }})</li>
        </ul>
        <p class="mt-2 text-xs text-[var(--muted)]">
          Residential-only model. For white sites and mixed-use parcels, the office and retail components are not valued.
        </p>
      </details>

      <div class="border-t border-[var(--border)] pt-4">
        <h3 class="mb-2 font-semibold">AI assessment</h3>
        <AiPanel :slug="slug" :gfa-sqft="v.gfaSqft" :enabled="data.aiEnabled" />
      </div>
    </div>
  </section>
</template>
