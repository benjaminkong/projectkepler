<script setup lang="ts">
import { STAR_PATH } from "../lib/map";

withDefaults(defineProps<{ size?: number }>(), { size: 28 });
</script>

<template>
  <svg viewBox="0 0 24 24" :width="size" :height="size" aria-label="Nearest station" role="img">
    <path :d="STAR_PATH" fill="#fbbf24" stroke="#92400e" stroke-width="1.2" stroke-linejoin="round" />
  </svg>
</template>
