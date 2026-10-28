<script setup lang="ts">
import { computed, ref } from "vue";
import { CATEGORIES, type CategoryId } from "@tender/core/categories";
import type { NearbyResult } from "@tender/core/nearby";
import CategoryGroup from "./CategoryGroup.vue";
import SiteMap from "./SiteMap.vue";
import { placeKey, type ExplorerSite, type FocusTarget } from "./explorer";

const props = defineProps<{ site: ExplorerSite; nearby: Record<CategoryId, NearbyResult> }>();

// FR-2.7: every place starts selected, so we track only the ones the user hides.
const hidden = ref<Set<string>>(new Set());
const focus = ref<FocusTarget>(null);
let clicks = 0;

const allKeys = computed(() => CATEGORIES.flatMap((c) => props.nearby[c.id].items.map((_, i) => placeKey(c.id, i))));
</script>

<template>
  <div class="grid grid-cols-1 gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
    <aside
      class="order-2 min-w-0 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 lg:order-1 lg:max-h-[44rem] lg:overflow-y-auto"
      aria-label="Map places"
    >
      <div class="mb-1 flex items-center justify-between">
        <h2 class="font-semibold">Show on map</h2>
        <div class="flex gap-2 text-xs">
          <button type="button" class="underline" @click="hidden = new Set()">Select all</button>
          <button type="button" class="underline" @click="hidden = new Set(allKeys)">Clear all</button>
        </div>
      </div>
      <p class="mb-2 text-xs text-[var(--muted)]">
        Within 1 km of the site. Primary schools widen to 2 km when none are within 1 km. Tick or untick a group or single
        places; click a name to find it on the map.
      </p>
      <CategoryGroup
        v-for="c in CATEGORIES"
        :key="c.id"
        v-model:hidden="hidden"
        :category="c"
        :result="nearby[c.id]"
        @focus="(index) => (focus = { category: c.id, index, n: ++clicks })"
      />
    </aside>

    <div
      class="order-1 h-[60vh] min-h-[420px] min-w-0 overflow-hidden rounded-2xl border border-[var(--border)] lg:order-2 lg:h-[44rem]"
    >
      <SiteMap :site="site" :nearby="nearby" :hidden="hidden" :focus="focus" />
    </div>
  </div>
</template>
