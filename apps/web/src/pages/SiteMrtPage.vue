<script setup lang="ts">
import { MINS_PER_STOP, STATIONS_EACH_SIDE, WALK_METRES_PER_MIN } from "@tender/core/mrtLines";
import NearbyMrtDiagram from "../components/NearbyMrtDiagram.vue";
import type { SiteMrtResponse } from "../lib/api";
import { useSiteResource } from "../lib/useSite";
import NotFoundPage from "./NotFoundPage.vue";

const props = defineProps<{ slug: string }>();
const { data, error, notFound } = useSiteResource<SiteMrtResponse>(
  `/api/sites/${encodeURIComponent(props.slug)}/mrt`,
  (d) => `Nearby MRT · ${d.site.name}`,
);
</script>

<template>
  <NotFoundPage v-if="notFound" />
  <p v-else-if="error" class="rounded-2xl border border-red-300 bg-red-50 p-5 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
    We couldn't load nearby stations right now ({{ error }}).
  </p>
  <p v-else-if="!data" class="animate-pulse text-sm text-[var(--muted)]">Finding the nearest stations on foot…</p>
  <div v-else class="space-y-6">
    <nav class="text-sm">
      <RouterLink :to="`/sites/${slug}`" class="text-[var(--muted)] hover:underline">← {{ data.site.name }}</RouterLink>
    </nav>

    <header class="space-y-2">
      <h1 class="text-3xl font-semibold tracking-tight">Nearby MRT</h1>
      <p class="max-w-3xl text-[var(--muted)]">
        The 3 stations closest on foot to the {{ data.site.name }} parcel (starred), on every line they serve, with the next
        {{ STATIONS_EACH_SIDE }} stations in each direction. Untick stations under each line to show only the ones you want.
      </p>
    </header>

    <p v-if="data.nearby.length === 0" class="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6 text-[var(--muted)]">
      We could not locate this site, so nearby stations are unavailable.
    </p>
    <NearbyMrtDiagram v-else :nearby="data.nearby" />

    <p class="text-xs text-[var(--muted)]">
      Distances are walking routes from the parcel centre along OpenStreetMap paths (straight line where no route is found);
      walking times assume {{ WALK_METRES_PER_MIN }} m per minute. Travel times are estimates at about {{ MINS_PER_STOP }} minutes
      per stop, counted from the nearest starred station. Station codes: LTA. Station locations: LTA MRT station exits (data.gov.sg).
    </p>
  </div>
</template>
