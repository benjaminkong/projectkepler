<script setup lang="ts">
import { computed, ref } from "vue";
import type { Category } from "@tender/core/categories";
import { shortDistance, type NearbyResult } from "@tender/core/nearby";
import { placeKey } from "./explorer";

const props = defineProps<{ category: Category; result: NearbyResult; hidden: Set<string> }>();
const emit = defineEmits<{ "update:hidden": [Set<string>]; focus: [index: number] }>();

const open = ref(true);
const keys = computed(() => props.result.items.map((_, i) => placeKey(props.category.id, i)));
const shown = computed(() => keys.value.filter((k) => !props.hidden.has(k)).length);
const allShown = computed(() => keys.value.length > 0 && shown.value === keys.value.length);

/** Any place shown -> hide the whole group; none shown -> show them all. */
function toggleGroup() {
  const next = new Set(props.hidden);
  for (const k of keys.value) {
    if (shown.value > 0) next.add(k);
    else next.delete(k);
  }
  emit("update:hidden", next);
}

function togglePlace(key: string) {
  const next = new Set(props.hidden);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  emit("update:hidden", next);
}
</script>

<template>
  <div class="border-b border-[var(--border)] py-2 last:border-b-0">
    <div class="flex items-center gap-3 rounded-lg px-1 py-1">
      <input
        type="checkbox"
        :checked="allShown"
        :indeterminate="shown > 0 && !allShown"
        :aria-label="`Show all ${category.label}`"
        class="h-4 w-4 accent-teal-700"
        @change="toggleGroup"
      />
      <span class="poi-marker h-6 w-6 shrink-0 text-[10px]" :style="{ background: category.color }" aria-hidden="true">
        {{ category.glyph }}
      </span>
      <span class="flex-1 text-sm font-medium">
        {{ category.label }}
        <span class="font-normal text-[var(--muted)]">({{ shown === keys.length ? keys.length : `${shown}/${keys.length}` }})</span>
      </span>
      <span
        v-if="result.widened"
        class="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-900 dark:bg-amber-400/20 dark:text-amber-200"
        title="No primary school within 1 km, so the search widened to 2 km"
      >
        2 km
      </span>
      <button
        type="button"
        :aria-expanded="open"
        :aria-label="`${open ? 'Collapse' : 'Expand'} ${category.label}`"
        class="rounded px-1 text-xs text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
        @click="open = !open"
      >
        <span :class="['inline-block transition', open ? 'rotate-180' : '']">▾</span>
      </button>
    </div>

    <template v-if="open">
      <p v-if="result.items.length === 0" class="py-1 pl-9 text-sm text-[var(--muted)]">
        None within {{ category.widenTo2km ? "2" : "1" }} km
      </p>
      <ul v-else class="mt-1 space-y-0.5 pl-7">
        <li v-for="(p, i) in result.items" :key="keys[i]" class="flex items-center gap-2">
          <input
            type="checkbox"
            :checked="!hidden.has(keys[i])"
            :aria-label="`Show ${p.name}`"
            class="h-3.5 w-3.5 shrink-0 accent-teal-700"
            @change="togglePlace(keys[i])"
          />
          <button
            type="button"
            :disabled="hidden.has(keys[i])"
            title="Show on map"
            class="flex min-w-0 flex-1 justify-between gap-2 rounded px-1 py-0.5 text-left text-sm hover:bg-black/5 disabled:opacity-50 disabled:hover:bg-transparent dark:hover:bg-white/5"
            @click="emit('focus', i)"
          >
            <span class="truncate">{{ p.name }}</span>
            <span class="shrink-0 tabular-nums text-[var(--muted)]">{{ shortDistance(p) }}</span>
          </button>
        </li>
      </ul>
    </template>
  </div>
</template>
