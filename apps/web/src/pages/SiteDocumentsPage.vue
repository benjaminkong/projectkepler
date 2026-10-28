<script setup lang="ts">
import DocumentsManager from "../components/DocumentsManager.vue";
import type { SiteResponse } from "../lib/api";
import { useSiteResource } from "../lib/useSite";
import NotFoundPage from "./NotFoundPage.vue";

const props = defineProps<{ slug: string }>();
const { data, error, notFound } = useSiteResource<SiteResponse>(
  `/api/sites/${encodeURIComponent(props.slug)}?nearby=0`,
  (d) => `Tender documents · ${d.site.name}`,
);
</script>

<template>
  <NotFoundPage v-if="notFound" />
  <p v-else-if="error" class="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
    We couldn't load this site right now ({{ error }}).
  </p>
  <p v-else-if="!data" class="animate-pulse text-sm text-[var(--muted)]">Loading…</p>
  <div v-else class="space-y-6">
    <nav class="text-sm">
      <RouterLink to="/" class="text-[var(--muted)] hover:underline">← All tender sites</RouterLink>
    </nav>
    <header>
      <h1 class="text-3xl font-semibold tracking-tight">Tender Documents</h1>
      <p class="mt-1 text-[var(--muted)]">
        {{ data.site.name }} · upload the Conditions of Tender (COT) and Technical Conditions of Tender (TCOT), then generate.
      </p>
    </header>
    <DocumentsManager :slug="data.site.slug" />
  </div>
</template>
