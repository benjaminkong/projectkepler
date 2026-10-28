<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import AppSpinner from "./AppSpinner.vue";
import MultiSelect, { type Option } from "./MultiSelect.vue";

export interface FilterValues {
  districts: string[];
  projects: string[];
  priceFrom?: string;
  priceTo?: string;
  dateFrom?: string;
  dateTo?: string;
  /** Tender site slug for the Excel export's subject row. */
  subject?: string;
}

const props = defineProps<{
  initial: FilterValues;
  /** Current tender sites, offered as the Excel export's subject site. */
  sites: { slug: string; name: string }[];
  /** District code -> general location, e.g. "09" -> "Orchard, Cairnhill, River Valley" */
  districts: Record<string, string>;
  /** True while the page loads transactions for the applied filters. */
  applying: boolean;
}>();

const router = useRouter();
const form = ref<HTMLFormElement>();
const selectedDistricts = ref([...props.initial.districts]);
const selectedProjects = ref([...props.initial.projects]);
const projectNames = ref<string[] | null>(null);
const projectError = ref(false);
// Loading projects downloads the URA dataset, so wait until the list is needed.
const projectsWanted = ref(props.initial.projects.length > 0);
const download = ref<{ state: "idle" | "busy" | "error"; message?: string }>({ state: "idle" });
const busy = computed(() => props.applying || download.value.state === "busy");

const inputClass =
  "w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm font-normal outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";

const districtOptions = computed<Option[]>(() =>
  // Sort explicitly: JS lists integer-like keys ("10"-"28") before "01"-"09".
  Object.entries(props.districts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([d, name]) => ({ value: d, label: `D${d} · ${name}` })),
);
const projectOptions = computed<Option[]>(() => (projectNames.value ?? []).map((p) => ({ value: p, label: p })));

/** The form's values as query parameters (repeated keys for districts and projects). */
function formParams() {
  const params = new URLSearchParams();
  for (const [k, v] of new FormData(form.value!)) if (typeof v === "string" && v) params.append(k, v);
  return params;
}

function apply() {
  const query: Record<string, string | string[]> = {};
  for (const [k, v] of formParams()) {
    const prev = query[k];
    query[k] = prev === undefined ? v : [...(Array.isArray(prev) ? prev : [prev]), v];
  }
  router.push({ path: "/transactions", query });
}

/** "attachment; filename=\"X.xlsx\"" -> "X.xlsx" */
const fileNameFrom = (disposition: string | null) => disposition?.match(/filename="([^"]+)"/)?.[1] ?? "comparables.xlsx";

/** Fetches the export with the current form values, so we can show progress and errors. */
async function downloadExcel() {
  download.value = { state: "busy" };
  try {
    const res = await fetch(`/api/transactions/export?${formParams()}`);
    if (!res.ok) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error ?? `Download failed (${res.status}).`);
    }
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = fileNameFrom(res.headers.get("Content-Disposition"));
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    // The browser shows the download itself; clear the loading message.
    download.value = { state: "idle" };
  } catch (err) {
    download.value = { state: "error", message: (err as Error).message };
  }
}

// The project list depends on the chosen districts (all projects when none are chosen).
let controller: AbortController | undefined;
watch(
  [() => [...selectedDistricts.value].sort().join(","), projectsWanted],
  ([districtKey, wanted]) => {
    if (!wanted) return;
    controller?.abort();
    controller = new AbortController();
    projectNames.value = null;
    projectError.value = false;
    const qs = new URLSearchParams(districtKey ? districtKey.split(",").map((d) => ["district", d]) : []);
    fetch(`/api/transactions/projects?${qs}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(({ projects }: { projects: string[] }) => {
        projectNames.value = projects;
        // Drop chosen projects that are not in the newly chosen districts.
        const valid = new Set(projects);
        selectedProjects.value = selectedProjects.value.filter((p) => valid.has(p));
      })
      .catch((err) => {
        if (err.name !== "AbortError") projectError.value = true;
      });
  },
  { immediate: true },
);

const projectLabel = computed(() => {
  const n = selectedDistricts.value.length;
  return n ? `Project (in ${n} district${n > 1 ? "s" : ""})` : "Project";
});
</script>

<template>
  <form
    ref="form"
    :aria-busy="busy"
    class="grid gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:grid-cols-2 lg:grid-cols-6"
    @submit.prevent="apply"
  >
    <!-- Marks the form as submitted, so "Apply" with no filters still shows everything. -->
    <input type="hidden" name="applied" value="1" />
    <div class="lg:col-span-3">
      <MultiSelect v-model="selectedDistricts" name="district" label="District" :options="districtOptions" placeholder="All districts" />
    </div>
    <div class="lg:col-span-3">
      <MultiSelect
        v-model="selectedProjects"
        name="project"
        :label="projectLabel"
        :options="projectOptions"
        placeholder="All projects"
        :loading="projectNames === null && !projectError"
        :disabled-text="projectError ? 'Couldn\'t load projects, try again later' : undefined"
        @open="projectsWanted = true"
      />
    </div>
    <label class="space-y-1 text-xs font-medium">
      <span>Price from ($)</span>
      <input name="priceFrom" type="number" min="0" step="10000" inputmode="numeric" :value="initial.priceFrom ?? ''" placeholder="Min" :class="inputClass" />
    </label>
    <label class="space-y-1 text-xs font-medium">
      <span>Price to ($)</span>
      <input name="priceTo" type="number" min="0" step="10000" inputmode="numeric" :value="initial.priceTo ?? ''" placeholder="Max" :class="inputClass" />
    </label>
    <label class="space-y-1 text-xs font-medium">
      <span>Date from</span>
      <input name="dateFrom" type="month" :value="initial.dateFrom ?? ''" :class="inputClass" />
    </label>
    <label class="space-y-1 text-xs font-medium">
      <span>Date to</span>
      <input name="dateTo" type="month" :value="initial.dateTo ?? ''" :class="inputClass" />
    </label>
    <label class="space-y-1 text-xs font-medium sm:col-span-2">
      <span>Subject site (for the Excel export)</span>
      <select name="subject" :class="inputClass">
        <option value="">None</option>
        <option v-for="s in sites" :key="s.slug" :value="s.slug" :selected="s.slug === initial.subject">{{ s.name }}</option>
      </select>
    </label>
    <div class="flex flex-wrap items-end gap-2 sm:col-span-2 lg:col-span-4">
      <button
        type="submit"
        :disabled="busy"
        class="flex-1 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong disabled:cursor-wait disabled:opacity-80"
      >
        <template v-if="applying"><AppSpinner /> Loading transactions…</template>
        <template v-else>Apply filters</template>
      </button>
      <button
        type="button"
        :disabled="selectedProjects.length === 0 || busy"
        :title="selectedProjects.length === 0 ? 'Select at least one project to download' : 'Download the comparables sheet for the selected projects'"
        class="rounded-lg border border-brand px-4 py-2 text-sm font-medium text-brand hover:bg-brand/10 disabled:cursor-not-allowed disabled:border-[var(--border)] disabled:text-[var(--muted)] disabled:hover:bg-transparent dark:text-teal-300"
        @click="downloadExcel"
      >
        <template v-if="download.state === 'busy'"><AppSpinner /> Preparing Excel…</template>
        <template v-else>⬇ Download Excel</template>
      </button>
      <RouterLink to="/transactions" class="rounded-lg border border-[var(--border)] px-4 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10">
        Reset
      </RouterLink>
    </div>
    <p
      v-if="applying || download.state !== 'idle'"
      role="status"
      :class="[
        'text-sm sm:col-span-2 lg:col-span-6',
        download.state === 'error' && !applying ? 'text-red-700 dark:text-red-300' : 'text-[var(--muted)]',
      ]"
    >
      {{
        applying
          ? "Loading transactions… The first search after a while downloads URA's data and can take about 10 seconds."
          : download.state === "busy"
            ? "Preparing the comparables Excel… Looking up locations and walking routes can take up to a minute the first time."
            : download.message
      }}
    </p>
  </form>
</template>
