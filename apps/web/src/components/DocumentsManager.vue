<script setup lang="ts">
import { computed, ref } from "vue";
import type { DocType, StoredDocument } from "@tender/core/agentcore";
import DocCard from "./DocCard.vue";
import { fmtWhen } from "./documents";

const props = defineProps<{ slug: string }>();

const DOC_TYPES: DocType[] = ["COT", "TCOT"];
const DOC_LABELS: Record<DocType, string> = {
  COT: "Conditions of Tender",
  TCOT: "Technical Conditions of Tender",
};

interface DocumentsState {
  configured: boolean;
  uploaded: Partial<Record<DocType, StoredDocument>>;
  generated: StoredDocument[];
  error?: string;
}

const state = ref<DocumentsState | null>(null);
const generating = ref(false);
const genError = ref<string | null>(null);

async function load() {
  try {
    const res = await fetch(`/api/sites/${props.slug}/documents`);
    const json = await res.json();
    state.value = { configured: json.configured !== false, uploaded: json.uploaded ?? {}, generated: json.generated ?? [], error: json.error };
  } catch {
    state.value = { configured: true, uploaded: {}, generated: [], error: "Could not load documents." };
  }
}
load();

const both = computed(() => Boolean(state.value?.uploaded.COT && state.value?.uploaded.TCOT));
const off = computed(() => !state.value?.configured);

/** Re-reads the generated files every 15 s until a new one appears (up to 10 minutes). */
async function waitForNewReport(before: number) {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 15_000));
    const res = await fetch(`/api/sites/${props.slug}/documents`).catch(() => null);
    const json = res?.ok ? await res.json() : null;
    if (json && (json.generated?.length ?? 0) > before && state.value) {
      state.value = { ...state.value, generated: json.generated, uploaded: json.uploaded ?? state.value.uploaded };
      return true;
    }
  }
  return false;
}

async function runGenerate() {
  generating.value = true;
  genError.value = null;
  const before = state.value?.generated.length ?? 0;
  try {
    const res = await fetch(`/api/sites/${props.slug}/documents/generate`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) throw new Error(json.error ?? "Could not generate the report.");
    await load();
    // Still running on the agent's side (202), or finished but not listed yet: keep checking.
    if (res.status === 202 || !json.done) {
      if (!(await waitForNewReport(before))) genError.value = "Still generating. Refresh the page in a few minutes.";
    }
  } catch (err) {
    genError.value = (err as Error).message;
  } finally {
    generating.value = false;
  }
}
</script>

<template>
  <p v-if="!state" class="animate-pulse text-sm text-[var(--muted)]">Loading documents…</p>
  <div v-else class="space-y-3">
    <p
      v-if="state.error"
      class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200"
    >
      {{ state.error }}
    </p>
    <DocCard
      v-for="t in DOC_TYPES"
      :key="t"
      :slug="slug"
      :type="t"
      :label="DOC_LABELS[t]"
      :current="state.uploaded[t]"
      :disabled="off"
      @uploaded="load"
    />

    <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
      <div class="mb-4 flex items-center justify-between gap-4">
        <h2 class="text-lg font-semibold">Generated Files</h2>
        <button
          type="button"
          :disabled="!both || generating || off"
          :title="both ? 'Generate from the uploaded COT and TCOT' : 'Upload both COT and TCOT first'"
          class="rounded-full bg-violet-700 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-800 disabled:cursor-not-allowed disabled:bg-[var(--border)] disabled:text-[var(--muted)]"
          @click="runGenerate"
        >
          {{ generating ? "Generating… (can take a few minutes)" : "Generate" }}
        </button>
      </div>
      <p v-if="genError" class="mb-3 text-sm text-red-700 dark:text-red-300">{{ genError }}</p>
      <div class="overflow-hidden rounded-md border border-[var(--border)]">
        <table class="w-full text-sm">
          <thead class="bg-[var(--bg)] text-left">
            <tr>
              <th class="w-1/2 px-6 py-3 font-semibold">File Name</th>
              <th class="px-6 py-3 font-semibold">Date Created</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="state.generated.length === 0">
              <td colspan="2" class="px-6 py-4 text-[var(--muted)]">
                {{ both ? "No files generated yet." : "Upload COT and TCOT, then click Generate." }}
              </td>
            </tr>
            <template v-else>
              <tr v-for="f in state.generated" :key="`${f.fileName}-${f.uploadedAt}`" class="border-t border-[var(--border)]">
                <td class="px-6 py-3">
                  <a v-if="f.url" :href="f.url" target="_blank" rel="noopener" class="underline">{{ f.fileName }}</a>
                  <template v-else>{{ f.fileName }}</template>
                </td>
                <td class="px-6 py-3 tabular-nums">{{ fmtWhen(f.uploadedAt) }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </div>
    </section>
  </div>
</template>
