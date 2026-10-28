<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { Transaction } from "@tender/core/transactions";
import TransactionFilters, { type FilterValues } from "../components/TransactionFilters.vue";
import { api } from "../lib/api";
import { fmtMoney, fmtMonth, fmtNumber } from "../lib/format";

interface Meta {
  districts: Record<string, string>;
  sites: { slug: string; name: string }[];
}
interface Results {
  total: number;
  page: number;
  pages: number;
  pageSize: number;
  rows: Transaction[];
  stats: { medianPrice?: number; medianPsf?: number; highestPrice?: number };
  earliestMonth?: string;
  latestMonth?: string;
  loadedAt: string;
}

const route = useRoute();
const all = (v: unknown) => [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((x) => String(x).trim()).filter(Boolean))];
const one = (v: unknown) => all(v)[0];

const meta = ref<Meta>({ districts: {}, sites: [] });
api<Meta>("/api/transactions/meta").then((m) => (meta.value = m), () => {});

const initial = computed<FilterValues>(() => {
  const q = route.query;
  return {
    districts: all(q.district),
    projects: all(q.project),
    priceFrom: one(q.priceFrom),
    priceTo: one(q.priceTo),
    dateFrom: one(q.dateFrom),
    dateTo: one(q.dateTo),
    subject: one(q.subject),
  };
});
// Remount the form when the filters change from outside it (Reset, back/forward), not on paging.
const formKey = computed(() => JSON.stringify(initial.value));

// Don't load anything until the user applies filters (the URA download is ~29 MB).
const applied = computed(() => {
  const f = initial.value;
  return one(route.query.applied) === "1" || f.districts.length > 0 || f.projects.length > 0 || [f.priceFrom, f.priceTo, f.dateFrom, f.dateTo].some(Boolean);
});

const results = ref<Results | null>(null);
const error = ref<string | null>(null);
const loading = ref(false);
let request = 0;

watch(
  () => route.fullPath,
  async () => {
    if (route.path !== "/transactions") return;
    if (!applied.value) {
      results.value = null;
      error.value = null;
      return;
    }
    const mine = ++request;
    loading.value = true;
    error.value = null;
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(route.query)) for (const val of all(v)) qs.append(k, val);
    try {
      const r = await api<Results>(`/api/transactions?${qs}`);
      if (mine === request) results.value = r;
    } catch (e) {
      if (mine === request) error.value = (e as Error).message;
    } finally {
      if (mine === request) loading.value = false;
    }
  },
  { immediate: true },
);

const pageTo = (p: number) => ({ path: "/transactions", query: { ...route.query, page: p > 1 ? String(p) : undefined } });
const first = computed(() => (results.value ? (results.value.page - 1) * results.value.pageSize + 1 : 0));
const last = computed(() => (results.value ? Math.min(results.value.page * results.value.pageSize, results.value.total) : 0));
const stats = computed(() => {
  const r = results.value;
  if (!r) return [];
  return [
    ["Transactions", fmtNumber(r.total) ?? "0"],
    ["Median price", fmtMoney(r.stats.medianPrice)],
    ["Median $psf", fmtMoney(r.stats.medianPsf)],
    ["Highest price", fmtMoney(r.stats.highestPrice)],
  ];
});
</script>

<template>
  <div class="space-y-6">
    <section class="space-y-2">
      <p class="text-sm font-medium uppercase tracking-wider text-brand dark:text-teal-300">URA private residential</p>
      <h1 class="text-3xl font-semibold tracking-tight sm:text-4xl">Recent transactions</h1>
      <p class="max-w-2xl text-[var(--muted)]">Caveats lodged for private homes over the last 5 years, newest first. Choose filters and click Apply.</p>
    </section>

    <TransactionFilters :key="formKey" :initial="initial" :districts="meta.districts" :sites="meta.sites" :applying="loading" />

    <p
      v-if="!applied"
      class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-[var(--muted)]"
    >
      Set your filters above and click <strong>Apply filters</strong> to see transactions.
    </p>
    <p
      v-else-if="error"
      class="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
    >
      {{ error }}
    </p>
    <template v-else-if="results">
      <div :class="['grid grid-cols-2 gap-3 lg:grid-cols-4', loading && 'opacity-60']">
        <div v-for="[label, value] in stats" :key="label" class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <p class="text-xs text-[var(--muted)]">{{ label }}</p>
          <p class="mt-1 text-xl font-semibold tabular-nums">{{ value }}</p>
        </div>
      </div>

      <p
        v-if="results.total === 0"
        class="rounded-2xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-10 text-center text-[var(--muted)]"
      >
        No transactions match these filters.
      </p>
      <div v-else :class="['overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface)]', loading && 'opacity-60']">
        <table class="w-full min-w-[960px] text-sm">
          <thead class="border-b border-[var(--border)] text-left text-xs text-[var(--muted)]">
            <tr>
              <th class="px-3 py-2.5 font-medium">Date</th>
              <th class="px-3 py-2.5 font-medium">Project</th>
              <th class="px-3 py-2.5 font-medium">District</th>
              <th class="px-3 py-2.5 font-medium">Type</th>
              <th class="px-3 py-2.5 font-medium">Sale</th>
              <th class="px-3 py-2.5 text-right font-medium">Area (sqft)</th>
              <th class="px-3 py-2.5 text-right font-medium">Price</th>
              <th class="px-3 py-2.5 text-right font-medium">$psf</th>
              <th class="px-3 py-2.5 font-medium">Floor</th>
              <th class="px-3 py-2.5 font-medium">Tenure</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="(r, i) in results.rows"
              :key="`${results.page}-${i}`"
              class="border-b border-[var(--border)] last:border-b-0 hover:bg-black/[0.03] dark:hover:bg-white/[0.03]"
            >
              <td class="whitespace-nowrap px-3 py-2 tabular-nums">{{ fmtMonth(r.month) }}</td>
              <td class="px-3 py-2">
                <span class="font-medium">{{ r.project }}</span>
                <span class="block text-xs text-[var(--muted)]">{{ r.street }}</span>
              </td>
              <td class="px-3 py-2 tabular-nums" :title="meta.districts[r.district]">
                D{{ r.district }} <span class="text-xs text-[var(--muted)]">{{ r.marketSegment }}</span>
              </td>
              <td class="px-3 py-2">{{ r.propertyType }}</td>
              <td class="px-3 py-2">{{ r.saleType }}</td>
              <td class="px-3 py-2 text-right tabular-nums">{{ fmtNumber(Math.round(r.areaSqm * 10.7639)) }}</td>
              <td class="px-3 py-2 text-right font-medium tabular-nums">
                {{ fmtMoney(r.price) }}
                <span v-if="r.noOfUnits > 1" class="block text-xs font-normal text-[var(--muted)]">{{ r.noOfUnits }} units</span>
              </td>
              <td class="px-3 py-2 text-right tabular-nums">{{ fmtMoney(r.psf) }}</td>
              <td class="whitespace-nowrap px-3 py-2">{{ r.floorRange === "-" ? "–" : r.floorRange }}</td>
              <td class="px-3 py-2 text-xs">{{ r.tenure }}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <nav v-if="results.pages > 1" class="flex items-center justify-between text-sm" aria-label="Pagination">
        <span class="text-[var(--muted)]">{{ fmtNumber(first) }}–{{ fmtNumber(last) }} of {{ fmtNumber(results.total) }}</span>
        <div class="flex gap-2">
          <RouterLink
            v-if="results.page > 1"
            :to="pageTo(results.page - 1)"
            class="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
          >
            ← Previous
          </RouterLink>
          <span class="px-2 py-1.5 tabular-nums">Page {{ results.page }} of {{ fmtNumber(results.pages) }}</span>
          <RouterLink
            v-if="results.page < results.pages"
            :to="pageTo(results.page + 1)"
            class="rounded-lg border border-[var(--border)] px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10"
          >
            Next →
          </RouterLink>
        </div>
      </nav>

      <p class="text-xs text-[var(--muted)]">
        Source: URA Data Service, private residential transactions{{
          results.earliestMonth && results.latestMonth ? ` from ${fmtMonth(results.earliestMonth)} to ${fmtMonth(results.latestMonth)}` : ""
        }}. Contract dates are by month. Area shown in square feet (URA reports square metres). Data refreshed
        {{ new Date(results.loadedAt).toLocaleString("en-SG", { timeZone: "Asia/Singapore" }) }}.
      </p>
    </template>
  </div>
</template>
