<script setup lang="ts">
import { computed } from "vue";
import { daysUntil } from "@tender/core/dates";
import { shortDistance, type NearbyResult } from "@tender/core/nearby";
import type { SiteWithNearby } from "../lib/api";
import { closesInLabel, fmtDate, fmtNumber } from "../lib/format";

const props = defineProps<{ site: SiteWithNearby }>();

const BADGE: Record<string, string> = {
  open: "bg-teal-50 text-teal-800 dark:bg-teal-400/15 dark:text-teal-200",
  urgent: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-200",
  closed: "bg-amber-100 text-amber-900 dark:bg-amber-400/15 dark:text-amber-200",
  awarded: "bg-slate-200 text-slate-800 dark:bg-slate-400/20 dark:text-slate-200",
  upcoming: "bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200",
  other: "bg-slate-100 text-slate-700 dark:bg-slate-400/15 dark:text-slate-300",
};

const f = computed(() => props.site.facts);
const days = computed(() => (props.site.tenderCloseDate ? daysUntil(props.site.tenderCloseDate) : undefined));
const urgent = computed(() => days.value !== undefined && days.value >= 0 && days.value <= 7);

/** Countdown for open sites; URA's status for the rest. */
const badge = computed(() => {
  const s = props.site;
  const key = s.statusKey ?? (days.value !== undefined ? "open" : undefined);
  if (!key) return null;
  const text =
    key === "open" && days.value !== undefined && days.value >= 0 ? closesInLabel(days.value) : (s.status ?? closesInLabel(days.value ?? -1));
  return { text, cls: BADGE[key === "open" && urgent.value ? "urgent" : key] };
});

const stats = computed(() => {
  const s = props.site;
  const x = f.value;
  return [
    ["Site area", x.siteAreaSqm ? `${fmtNumber(x.siteAreaSqm)} m²` : undefined],
    ["Max GFA", x.maxGfaSqm ? `${fmtNumber(x.maxGfaSqm)} m²` : undefined],
    ["GPR", x.grossPlotRatio?.toString()],
    ["Est. units", fmtNumber(x.housingUnits)],
    ["Lease", x.leaseYears ? `${x.leaseYears} yrs` : undefined],
    s.estimatedLaunch
      ? ["Est. launch", s.estimatedLaunch]
      : [s.statusKey === "open" ? "Tender closes" : "Tender closed", fmtDate(s.tenderCloseDate)],
  ].filter(([, v]) => v) as [string, string][];
});

function nearbyLine(singular: string, plural: string, r?: NearbyResult) {
  if (!r) return null;
  if (r.items.length === 0) return `No ${plural} within ${r.radiusM / 1000} km`;
  const within = r.widened ? "2 km" : "1 km";
  const label = r.items.length === 1 ? singular : plural;
  return `${r.items.length} ${label} within ${within} · nearest ${shortDistance(r.items[0])}`;
}
</script>

<template>
  <div
    class="group flex flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--surface)] shadow-sm transition hover:-translate-y-0.5 hover:shadow-md"
  >
    <RouterLink :to="`/sites/${site.slug}`" class="flex flex-1 flex-col focus-visible:outline-2 focus-visible:outline-brand">
      <img
        v-if="site.imageUrl"
        :src="site.imageUrl"
        :alt="`Location plan of ${site.name}`"
        class="aspect-[3/2] w-full bg-white object-cover"
        loading="lazy"
      />
      <div class="flex flex-1 flex-col gap-4 p-5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="text-lg font-semibold group-hover:text-brand dark:group-hover:text-teal-300">
              {{ site.name }}
              <span
                v-if="site.poc"
                class="ml-2 rounded bg-violet-100 px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-violet-900 dark:bg-violet-400/20 dark:text-violet-200"
                :title="`Proof of concept: not on URA's current Sites for Tender list${site.status ? ` (${site.status})` : ''}`"
              >
                POC
              </span>
            </h2>
            <p class="text-sm text-[var(--muted)]">
              {{ site.developmentType }}{{ f.planningArea ? ` · ${f.planningArea}` : "" }}{{ f.region ? ` (${f.region})` : "" }}
            </p>
          </div>
          <span v-if="badge" :class="['shrink-0 rounded-full px-2.5 py-1 text-xs font-medium', badge.cls]">{{ badge.text }}</span>
        </div>

        <dl class="grid grid-cols-3 gap-3 text-sm">
          <div v-for="[label, value] in stats" :key="label">
            <dt class="text-xs text-[var(--muted)]">{{ label }}</dt>
            <dd class="font-medium">{{ value }}</dd>
          </div>
        </dl>

        <ul class="mt-auto space-y-1 border-t border-[var(--border)] pt-3 text-sm">
          <li>🚇 {{ nearbyLine("MRT/LRT station", "MRT/LRT stations", site.nearby?.mrt) }}</li>
          <li>🏫 {{ nearbyLine("primary school", "primary schools", site.nearby?.primary_school) }}</li>
        </ul>
      </div>
    </RouterLink>
    <!-- Separate from the card link: a link can't contain another link. -->
    <div class="flex justify-end border-t border-[var(--border)] px-5 py-3">
      <RouterLink
        :to="`/sites/${site.slug}/documents`"
        class="rounded-full border border-brand px-3 py-1.5 text-sm font-medium text-brand hover:bg-brand/10 dark:border-teal-300 dark:text-teal-300"
      >
        Upload documents
      </RouterLink>
    </div>
  </div>
</template>
