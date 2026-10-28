<script setup lang="ts">
import type { LineStop } from "@tender/core/mrtLines";

/** Station pill: one coloured segment per line code, like the LTA signage. */
defineProps<{ codes: LineStop["codes"]; large?: boolean }>();
</script>

<template>
  <span class="inline-flex overflow-hidden rounded-full border-2 border-[var(--surface)] shadow-sm">
    <span
      v-for="c in codes"
      :key="c.code"
      :class="['font-bold text-white', large ? 'px-2.5 py-1 text-sm' : 'px-2 py-0.5 text-xs']"
      :style="{ background: c.color }"
    >
      {{ c.code }}
    </span>
  </span>
</template>
