<script setup lang="ts">
import ThemeToggle from "./components/ThemeToggle.vue";
import UserMenu from "./components/UserMenu.vue";
import { user } from "./lib/auth";
</script>

<template>
  <header class="sticky top-0 z-[1100] border-b border-[var(--border)] bg-[var(--surface)]/90 backdrop-blur">
    <div class="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6">
      <RouterLink to="/" class="flex items-center gap-2 font-semibold tracking-tight">
        <span class="inline-block h-6 w-6 rounded-md bg-brand" aria-hidden="true" />
        <span class="hidden sm:inline">Tender Sites Portal</span>
      </RouterLink>
      <div class="flex items-center gap-1 sm:gap-3">
        <nav class="flex gap-1 text-sm" aria-label="Main">
          <RouterLink to="/" class="rounded-full px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10">Tender sites</RouterLink>
          <RouterLink to="/transactions" class="rounded-full px-3 py-1.5 hover:bg-black/5 dark:hover:bg-white/10">
            Transactions
          </RouterLink>
        </nav>
        <ThemeToggle />
        <UserMenu v-if="user" :user="user" />
      </div>
    </div>
  </header>
  <main class="mx-auto max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
    <!-- Keyed by path so moving between sites remounts the page; query changes (filters) do not. -->
    <RouterView :key="$route.path" />
  </main>
  <footer class="mx-auto max-w-7xl px-4 pb-8 text-xs text-[var(--muted)] sm:px-6">
    Site data: <a class="underline" href="https://www.ura.gov.sg/land-sales/sites-for-tender/">URA</a>. Map:
    <a class="underline" href="https://www.onemap.gov.sg/">OneMap</a> © Singapore Land Authority. Amenities:
    <a class="underline" href="https://data.gov.sg/">data.gov.sg</a> under the Singapore Open Data Licence. Shopping malls ©
    <a class="underline" href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors. Distances are walking
    distances from the parcel centre along OpenStreetMap paths (routing by FOSSGIS), or straight line where no route is found.
  </footer>
</template>
