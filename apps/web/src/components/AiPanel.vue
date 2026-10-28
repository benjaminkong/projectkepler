<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import type { AiResult } from "@tender/core/aiValuation";
import { millions, psf } from "../lib/money";
import RangeTile from "./RangeTile.vue";

const props = defineProps<{ slug: string; gfaSqft?: number; enabled: boolean }>();
const state = ref<"loading" | "generating" | AiResult>("loading");

/** Get-or-create: the stored assessment comes back at once; a parcel without one is generated. */
async function load(refresh = false) {
  state.value = refresh ? "generating" : "loading";
  // A stored assessment answers within a second; if not, Claude is writing a new one.
  const slow = setTimeout(() => {
    if (state.value === "loading") state.value = "generating";
  }, 1500);
  try {
    const res = await fetch(`/api/sites/${props.slug}/valuation/ai${refresh ? "?refresh=1" : ""}`, { method: "POST" });
    state.value = (await res.json()) as AiResult;
  } catch {
    state.value = { ok: false, error: "failed", message: "Network error. Try again." };
  } finally {
    clearTimeout(slow);
  }
}

function regenerate() {
  if (window.confirm("Regenerate the AI assessment? This makes a new paid call and replaces the saved one.")) load(true);
}

onMounted(() => {
  if (props.enabled) load();
});

const result = computed(() => (typeof state.value === "object" ? state.value : null));
const ok = computed(() => (result.value?.ok ? result.value : null));
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString("en-SG", { timeZone: "Asia/Singapore", dateStyle: "medium", timeStyle: "short" });
</script>

<template>
  <p v-if="!enabled" class="text-sm text-[var(--muted)]">
    AI assessment is off. Set <code class="rounded bg-black/5 px-1 dark:bg-white/10">AWS_BEARER_TOKEN_BEDROCK</code> (Amazon
    Bedrock) or <code class="rounded bg-black/5 px-1 dark:bg-white/10">ANTHROPIC_API_KEY</code> on the server to let Claude
    review this estimate against the location factors.
  </p>
  <p v-else-if="state === 'loading'" class="animate-pulse text-sm text-[var(--muted)]">Loading AI assessment…</p>
  <p v-else-if="state === 'generating'" class="animate-pulse text-sm text-[var(--muted)]">
    Claude Opus 5.5 is writing the assessment for this parcel (about 30–60 seconds). It is saved, so later visits load instantly.
  </p>
  <div v-else-if="result && !result.ok" class="flex items-center gap-3 text-sm">
    <span class="text-red-700 dark:text-red-300">{{ result.message }}</span>
    <button type="button" class="underline" @click="load()">Retry</button>
  </div>
  <div v-else-if="ok" class="space-y-4">
    <div class="flex flex-wrap items-center gap-2">
      <span class="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-medium text-violet-900 dark:bg-violet-400/15 dark:text-violet-200">
        AI-assisted · {{ ok.assessment.confidence }} confidence
      </span>
      <span class="text-xs text-[var(--muted)]">
        {{ ok.model }} · {{ ok.stored ? "saved" : "generated" }} {{ fmtWhen(ok.generatedAt) }}
      </span>
      <button type="button" class="ml-auto text-xs underline" @click="regenerate">Regenerate</button>
    </div>
    <p class="text-sm">{{ ok.assessment.summary }}</p>
    <div class="grid gap-3 sm:grid-cols-3">
      <RangeTile label="AI launch price" unit="psf" :range="ok.assessment.launch_psf" :fmt="psf" />
      <RangeTile label="AI land price" unit="psf ppr" :range="ok.assessment.land_psf_ppr" :fmt="psf" />
      <RangeTile
        v-if="gfaSqft"
        label="AI total land price"
        unit=""
        :range="{
          low: ok.assessment.land_psf_ppr.low * gfaSqft,
          base: ok.assessment.land_psf_ppr.base * gfaSqft,
          high: ok.assessment.land_psf_ppr.high * gfaSqft,
        }"
        :fmt="millions"
      />
    </div>
    <div v-if="ok.assessment.drivers.length > 0">
      <h4 class="mb-1 text-sm font-semibold">What moved the price</h4>
      <ul class="space-y-1 text-sm">
        <li v-for="d in ok.assessment.drivers" :key="d.factor" class="flex gap-2">
          <span
            :class="[
              'w-14 shrink-0 text-right font-medium tabular-nums',
              d.effect === 'positive'
                ? 'text-green-700 dark:text-green-400'
                : d.effect === 'negative'
                  ? 'text-red-700 dark:text-red-400'
                  : 'text-[var(--muted)]',
            ]"
          >
            {{ d.impact_pct > 0 ? "+" : "" }}{{ d.impact_pct }}%
          </span>
          <span><strong>{{ d.factor }}.</strong> {{ d.reason }}</span>
        </li>
      </ul>
    </div>
    <div v-if="ok.assessment.risks.length > 0">
      <h4 class="mb-1 text-sm font-semibold">Risks</h4>
      <ul class="list-disc space-y-0.5 pl-5 text-sm">
        <li v-for="r in ok.assessment.risks" :key="r">{{ r }}</li>
      </ul>
    </div>
  </div>
</template>
