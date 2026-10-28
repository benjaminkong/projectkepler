<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import { signIn } from "../lib/auth";

const route = useRoute();
const failed = computed(() => route.query.error === "signin");
</script>

<template>
  <div class="py-20 text-center">
    <template v-if="failed">
      <h1 class="text-2xl font-semibold">Sign-in didn't work</h1>
      <p class="mt-2 text-[var(--muted)]">Microsoft sent back a response this app couldn't accept. Try again, or ask your administrator for access.</p>
    </template>
    <template v-else>
      <h1 class="text-2xl font-semibold">You've signed out</h1>
      <p class="mt-2 text-[var(--muted)]">Sign in with your Microsoft work account to use the Tender Sites Portal.</p>
    </template>
    <button type="button" class="mt-6 rounded-full bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-strong" @click="signIn('/')">
      Sign in
    </button>
  </div>
</template>
