<script setup lang="ts">
import { computed } from "vue";
import { formatDistance } from "@tender/core/geo";
import { MINS_PER_STOP, type DiagramRow } from "@tender/core/mrtLines";
import CodeBadge from "./CodeBadge.vue";
import StarIcon from "./StarIcon.vue";

const props = defineProps<{
  row: DiagramRow;
  /** Keys of surrounding stations the user unticked on this line. */
  hidden: Set<string>;
}>();
const emit = defineEmits<{ toggle: [stopKey: string]; showAll: [] }>();

// Starred stations always show; stop counts stay true to the line even when stations are hidden.
const visible = computed(() => props.row.stops.filter((s) => s.starred || !props.hidden.has(s.key)));
const optional = computed(() => props.row.stops.filter((s) => !s.starred));
const hiddenCount = computed(() => optional.value.filter((s) => props.hidden.has(s.key)).length);
const stops = (n: number) => `${n} stop${n > 1 ? "s" : ""}`;
</script>

<template>
  <section class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 sm:p-5">
    <div class="mb-2 flex flex-wrap items-center gap-x-4 gap-y-2">
      <span class="rounded-full px-3 py-1 text-sm font-semibold text-white" :style="{ background: row.line.color }">
        {{ row.line.name }}
      </span>
      <span v-for="s in row.stars" :key="s.key" class="flex items-center gap-1.5 text-sm text-[var(--muted)]">
        <StarIcon :size="16" />
        <span>
          <strong class="text-[var(--text)]">{{ s.name }}</strong> is {{ formatDistance(s.walkM ?? s.distanceM) }}
          {{ s.walkM !== undefined ? "on foot" : "in a straight line" }} from the parcel (≈{{ s.walkMins }}-min walk)
        </span>
      </span>
    </div>

    <div class="overflow-x-auto pb-2">
      <ol class="relative flex w-max items-start pt-1">
        <!-- The coloured track, from the first station's centre to the last's (the list is only as wide as its stations). -->
        <span aria-hidden="true" class="absolute left-14 right-14 h-1.5 rounded-full" :style="{ top: '4.1rem', background: row.line.color }" />
        <li v-for="s in visible" :key="s.key" class="relative flex w-28 flex-col items-center text-center">
          <div class="flex h-12 flex-col items-center justify-end pb-1 text-xs italic leading-tight text-[var(--muted)]">
            <StarIcon v-if="s.starred" />
            <template v-else>
              <span>≈{{ s.stopsAway * MINS_PER_STOP }} mins</span>
              <span>{{ stops(s.stopsAway) }}</span>
            </template>
          </div>
          <div class="flex h-8 items-center">
            <CodeBadge :codes="s.codes" :large="s.starred" />
          </div>
          <span :class="['mt-1.5 px-1 text-sm leading-tight', s.starred ? 'font-bold' : 'font-semibold']">{{ s.name }}</span>
        </li>
      </ol>
    </div>

    <fieldset v-if="optional.length > 0" class="mt-3 border-t border-[var(--border)] pt-3">
      <legend class="sr-only">Stations shown on the {{ row.line.name }}</legend>
      <div class="mb-2 flex items-center justify-between text-xs">
        <span class="font-medium text-[var(--muted)]">Stations shown ({{ optional.length - hiddenCount }} of {{ optional.length }})</span>
        <button v-if="hiddenCount > 0" type="button" class="underline" @click="emit('showAll')">Show all</button>
      </div>
      <div class="flex flex-wrap gap-1.5">
        <label
          v-for="s in optional"
          :key="s.key"
          :class="[
            'flex cursor-pointer items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition',
            !hidden.has(s.key)
              ? 'border-[var(--border)] bg-[var(--bg)]'
              : 'border-dashed border-[var(--border)] text-[var(--muted)] opacity-70',
          ]"
        >
          <input
            type="checkbox"
            :checked="!hidden.has(s.key)"
            class="h-3.5 w-3.5"
            :style="{ accentColor: row.line.color }"
            @change="emit('toggle', s.key)"
          />
          {{ s.name }}
          <span class="text-[var(--muted)]">· {{ stops(s.stopsAway) }}</span>
        </label>
      </div>
    </fieldset>
  </section>
</template>
