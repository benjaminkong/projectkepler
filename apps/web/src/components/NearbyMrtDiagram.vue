<script setup lang="ts">
import { computed, ref } from "vue";
import { formatDistance } from "@tender/core/geo";
import { buildDiagram, type NearbyStation } from "@tender/core/mrtLines";
import CodeBadge from "./CodeBadge.vue";
import MrtLineRow from "./MrtLineRow.vue";
import StarIcon from "./StarIcon.vue";

/** The 3 nearest stations (fixed) and a line diagram per line, with configurable surrounding stations. */
const props = defineProps<{ nearby: NearbyStation[] }>();
const rows = computed(() => buildDiagram(props.nearby));
// Unticked surrounding stations, per line id. Empty = every station shown (the default).
const hidden = ref<Record<string, Set<string>>>({});
const RANKS = ["Nearest", "2nd nearest", "3rd nearest"];

function toggle(lineId: string, stopKey: string) {
  const next = new Set(hidden.value[lineId]);
  if (next.has(stopKey)) next.delete(stopKey);
  else next.add(stopKey);
  hidden.value = { ...hidden.value, [lineId]: next };
}
</script>

<template>
  <section class="grid gap-3 sm:grid-cols-3">
    <div v-for="(s, i) in nearby" :key="s.key" class="flex items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <StarIcon :size="32" />
      <div class="min-w-0">
        <p class="text-xs text-[var(--muted)]">{{ RANKS[i] ?? `#${i + 1}` }}</p>
        <p class="font-semibold">{{ s.name }}</p>
        <p class="text-sm text-[var(--muted)]">
          {{ formatDistance(s.walkM ?? s.distanceM) }} {{ s.walkM !== undefined ? "walk" : "direct" }} · ≈{{ s.walkMins }} min
        </p>
        <div class="mt-1.5"><CodeBadge :codes="s.codes" /></div>
      </div>
    </div>
  </section>

  <div class="space-y-4">
    <MrtLineRow
      v-for="row in rows"
      :key="row.line.id"
      :row="row"
      :hidden="hidden[row.line.id] ?? new Set()"
      @toggle="(k) => toggle(row.line.id, k)"
      @show-all="hidden = { ...hidden, [row.line.id]: new Set() }"
    />
  </div>
</template>
