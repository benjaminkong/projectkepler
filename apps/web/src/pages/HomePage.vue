<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute } from "vue-router";
import type { StatusKey } from "@tender/core/ura";
import OverviewMap from "../components/OverviewMap.vue";
import SiteCard from "../components/SiteCard.vue";
import { api, type SitesResponse } from "../lib/api";

const URA_GLS_URL = "https://www.ura.gov.sg/land-sales/current-ura-gls-sites/";

type FilterKey = "all" | "open" | "closed" | "awarded";
const FILTERS: { key: FilterKey; label: string }[] = [
  { key: "all", label: "All" },
  { key: "open", label: "Open for tender" },
  { key: "closed", label: "Tender closed" },
  { key: "awarded", label: "Awarded" },
];

const route = useRoute();
const data = ref<SitesResponse | null>(null);
const error = ref<string | null>(null);
api<SitesResponse>("/api/sites")
  .then((d) => (data.value = d))
  .catch((e: Error) => (error.value = e.message));

// Default view: sites open for tender. "All" is /?status=all.
const active = computed<FilterKey>(() => FILTERS.find((f) => f.key === route.query.status)?.key ?? "open");

// "Open for tender" also covers sites with an estimated launch date (not yet launched).
const matches = (key: FilterKey, status?: StatusKey) => key === "all" || status === key || (key === "open" && status === "upcoming");
const count = (key: FilterKey) => data.value?.sites.filter((s) => matches(key, s.statusKey)).length ?? 0;
const sites = computed(() => data.value?.sites.filter((s) => matches(active.value, s.statusKey)) ?? []);
const mapSites = computed(() =>
  sites.value.filter((s) => s.center).map((s) => ({ slug: s.slug, name: s.name, type: s.status ?? s.developmentType, center: s.center! })),
);
</script>

<template>
  <div class="space-y-8">
    <section class="space-y-3">
      <p class="text-sm font-medium uppercase tracking-wider text-brand dark:text-teal-300">URA Government Land Sales</p>
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">URA GLS sites</h1>
      <p class="max-w-2xl text-[var(--muted)]">
        Every Confirmed List site in URA's current Government Land Sales programme, with the MRT stations, primary schools and
        everyday amenities around it. Pick a site to explore its neighbourhood.
      </p>
      <p class="text-xs text-[var(--muted)]">
        Source: <a :href="URA_GLS_URL" class="underline" target="_blank" rel="noopener">URA Current GLS Sites</a
        >{{ data?.uraLastUpdated ? `, last updated ${data.uraLastUpdated}` : "" }}.
      </p>
    </section>

    <p v-if="error" class="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
      We couldn't load sites from URA right now ({{ error }}). Please try again in a few minutes.
    </p>
    <p v-else-if="!data" class="animate-pulse text-sm text-[var(--muted)]">Loading sites from URA…</p>

    <template v-else>
      <nav aria-label="Filter by status" class="flex flex-wrap gap-2">
        <RouterLink
          v-for="f in FILTERS"
          :key="f.key"
          :to="f.key === 'open' ? '/' : { path: '/', query: { status: f.key } }"
          :aria-current="f.key === active ? 'page' : undefined"
          :class="[
            'rounded-full border px-3.5 py-1.5 text-sm font-medium transition',
            f.key === active
              ? 'border-brand bg-brand text-white'
              : 'border-[var(--border)] bg-[var(--surface)] hover:border-brand hover:text-brand dark:hover:text-teal-300',
          ]"
        >
          {{ f.label }} <span :class="f.key === active ? 'text-white/80' : 'text-[var(--muted)]'">({{ count(f.key) }})</span>
        </RouterLink>
      </nav>

      <div v-if="sites.length === 0" class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center">
        <p class="font-medium">No sites with this status right now.</p>
        <p class="mt-1 text-sm text-[var(--muted)]">
          See <RouterLink :to="{ path: '/', query: { status: 'all' } }" class="underline">all sites</RouterLink> or the
          <a :href="URA_GLS_URL" class="underline">URA Current GLS Sites page</a>.
        </p>
      </div>
      <template v-else>
        <div class="h-72 overflow-hidden rounded-2xl border border-[var(--border)] sm:h-80 xl:h-96">
          <OverviewMap :sites="mapSites" />
        </div>
        <div class="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          <SiteCard v-for="site in sites" :key="site.slug" :site="site" />
        </div>
      </template>
    </template>
  </div>
</template>
