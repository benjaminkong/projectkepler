<script setup lang="ts">
import type { Range } from "@tender/core/valuation";

defineProps<{ label: string; unit: string; range: Range; fmt: (n: number) => string }>();
</script>

<template>
  <div class="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-4">
    <p class="text-xs text-[var(--muted)]">{{ label }}</p>
    <p class="mt-1 text-2xl font-semibold tabular-nums">
      {{ fmt(range.base) }} <span class="text-sm font-normal text-[var(--muted)]">{{ unit }}</span>
    </p>
    <p class="text-xs tabular-nums text-[var(--muted)]">Range {{ fmt(range.low) }} – {{ fmt(range.high) }}</p>
  </div>
</template>
