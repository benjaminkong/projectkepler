<script setup lang="ts">
import { computed } from "vue";
import { CATEGORY_BY_ID, countNoun, type CategoryId } from "@tender/core/categories";
import { daysUntil } from "@tender/core/dates";
import { describeDistance, type NearbyResult } from "@tender/core/nearby";
import PriceEstimate from "../components/PriceEstimate.vue";
import SiteExplorer from "../components/SiteExplorer.vue";
import { type SiteResponse } from "../lib/api";
import { closesInLabel, fmtDate, fmtNumber } from "../lib/format";
import { useSiteResource } from "../lib/useSite";
import NotFoundPage from "./NotFoundPage.vue";

const props = defineProps<{ slug: string }>();
const { data, error, notFound } = useSiteResource<SiteResponse>(`/api/sites/${encodeURIComponent(props.slug)}`, (d) => d.site.name);

const site = computed(() => data.value?.site);
const days = computed(() => (site.value?.tenderCloseDate ? daysUntil(site.value.tenderCloseDate) : undefined));

const facts = computed(() => {
  const s = site.value;
  if (!s) return [];
  const f = s.facts;
  return (
    [
      ["Development", f.developmentCode ?? s.developmentType],
      ["Planning area", f.planningArea ? `${f.planningArea}${f.region ? ` (${f.region})` : ""}` : undefined],
      ["Site area", f.siteAreaSqm ? `${fmtNumber(f.siteAreaSqm)} m²` : undefined],
      ["Max GFA", f.maxGfaSqm ? `${fmtNumber(f.maxGfaSqm)} m²` : undefined],
      ["Gross plot ratio", f.grossPlotRatio?.toString()],
      ["Est. housing units", fmtNumber(f.housingUnits)],
      ["Lease", f.leaseYears ? `${f.leaseYears} years` : undefined],
      ["Tender submission", s.tenderSubmissionText || fmtDate(s.tenderCloseDate)],
    ] as [string, string | undefined][]
  ).filter(([, v]) => v);
});

/** "Why bid here" bullet points built from the data (FR-2.12). */
function highlights(nearby: Record<CategoryId, NearbyResult>) {
  const lines: string[] = [];
  const mrt = nearby.mrt;
  if (mrt.items.length) {
    lines.push(
      `${countNoun(CATEGORY_BY_ID.mrt, mrt.items.length)} within ${mrt.widened ? "2" : "1"} km. Nearest is ${mrt.items[0].name}, ${describeDistance(mrt.items[0])}.`,
    );
  }
  const schools = nearby.primary_school;
  if (schools.items.length) {
    lines.push(
      `${countNoun(CATEGORY_BY_ID.primary_school, schools.items.length)} within ${schools.widened ? "2" : "1"} km. Homes within 1 km of a school get priority in Primary 1 registration.`,
    );
  }
  const daily = (["mall", "hawker", "park"] as const)
    .filter((id) => nearby[id].items.length && !nearby[id].widened)
    .map((id) => countNoun(CATEGORY_BY_ID[id], nearby[id].items.length));
  if (daily.length) lines.push(`Within 1 km: ${daily.join(", ")}.`);
  return lines;
}

const linkClass = "rounded-full border border-[var(--border)] px-3 py-1 hover:bg-black/5 dark:hover:bg-white/10";
</script>

<template>
  <NotFoundPage v-if="notFound" />
  <p v-else-if="error" class="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
    We couldn't load this site right now ({{ error }}). Please try again in a few minutes.
  </p>
  <p v-else-if="!data || !site" class="animate-pulse text-sm text-[var(--muted)]">Loading site and walking distances…</p>
  <div v-else class="space-y-6">
    <nav class="text-sm">
      <RouterLink to="/" class="text-[var(--muted)] hover:underline">← All tender sites</RouterLink>
    </nav>

    <header class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-3xl font-semibold tracking-tight">{{ site.name }}</h1>
        <p class="text-[var(--muted)]">{{ site.developmentType }}</p>
      </div>
      <span
        v-if="days !== undefined"
        class="rounded-full bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 dark:bg-teal-400/15 dark:text-teal-200"
      >
        {{ closesInLabel(days) }} · {{ fmtDate(site.tenderCloseDate) }}
      </span>
    </header>

    <SiteExplorer
      v-if="data.nearby && site.center"
      :site="{ slug: site.slug, name: site.name, center: site.center, parcel: site.parcel }"
      :nearby="data.nearby"
    />
    <p v-else class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--muted)]">
      We could not locate this site on the map yet.
    </p>

    <PriceEstimate v-if="site.center" :slug="site.slug" />

    <div class="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <section class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 class="mb-3 font-semibold">Parcel facts</h2>
        <dl class="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <div v-for="[k, v] in facts" :key="k">
            <dt class="text-xs text-[var(--muted)]">{{ k }}</dt>
            <dd class="font-medium">{{ v }}</dd>
          </div>
        </dl>
        <div class="mt-4 flex flex-wrap gap-2 text-sm">
          <a :class="linkClass" :href="site.uraUrl" target="_blank" rel="noopener">URA site page ↗</a>
          <a v-if="site.facts.pressReleaseUrl" :class="linkClass" :href="site.facts.pressReleaseUrl" target="_blank" rel="noopener">
            Press release ↗
          </a>
          <a v-if="site.facts.technicalDocsUrl" :class="linkClass" :href="site.facts.technicalDocsUrl" target="_blank" rel="noopener">
            Technical documents ↗
          </a>
        </div>
      </section>

      <section class="rounded-2xl border border-teal-200 bg-teal-50/60 p-5 dark:border-teal-400/25 dark:bg-teal-400/5">
        <h2 class="mb-3 font-semibold">Why bid here</h2>
        <ul v-if="data.nearby" class="list-disc space-y-2 pl-5 text-sm">
          <li v-for="l in highlights(data.nearby)" :key="l">{{ l }}</li>
          <li v-if="site.facts.remarks">{{ site.facts.remarks }}</li>
        </ul>
        <p v-else class="text-sm text-[var(--muted)]">Neighbourhood data unavailable.</p>
      </section>
    </div>
  </div>
</template>
