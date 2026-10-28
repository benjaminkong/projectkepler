<script setup lang="ts">
import { isDark, toggleTheme } from "../lib/theme";
</script>

<template>
  <button
    type="button"
    :aria-label="isDark ? 'Switch to light mode' : 'Switch to dark mode'"
    class="flex h-9 items-center gap-2 rounded-full border border-[var(--border)] px-3 text-sm hover:bg-black/5 dark:hover:bg-white/10"
    @click="toggleTheme"
  >
    <span aria-hidden="true">{{ isDark ? "☀" : "☾" }}</span>
    <span class="hidden sm:inline">{{ isDark ? "Light" : "Dark" }}</span>
  </button>
</template>
