<script setup lang="ts">
import { ref } from "vue";
import type { DocType, StoredDocument } from "@tender/core/agentcore";
import { MAX_UPLOAD_BYTES } from "@tender/core/limits";
import PaperclipIcon from "./PaperclipIcon.vue";
import { fmtWhen } from "./documents";

const props = defineProps<{ slug: string; type: DocType; label: string; current?: StoredDocument; disabled: boolean }>();
const emit = defineEmits<{ uploaded: [] }>();

const file = ref<File | null>(null);
const busy = ref(false);
const error = ref<string | null>(null);
const input = ref<HTMLInputElement>();

async function upload() {
  if (!file.value) return;
  busy.value = true;
  error.value = null;
  try {
    // The server gets a presigned URL from the agent, then uploads the file to it.
    if (file.value.size > MAX_UPLOAD_BYTES) throw new Error(`Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.`);
    const form = new FormData();
    form.append("docType", props.type);
    form.append("file", file.value);
    const res = await fetch(`/api/sites/${props.slug}/documents/upload`, { method: "POST", body: form });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Upload failed.");
    file.value = null;
    if (input.value) input.value.value = "";
    emit("uploaded");
  } catch (err) {
    error.value = (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm">
    <h2 class="text-lg font-semibold">
      {{ type }} <span class="text-sm font-normal text-[var(--muted)]">· {{ label }}</span>
    </h2>
    <div class="mt-3 flex flex-wrap items-center gap-4">
      <label
        :class="[
          'flex h-12 w-full max-w-xl cursor-pointer items-center gap-4 rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 text-sm',
          disabled ? 'cursor-not-allowed opacity-60' : 'hover:border-brand',
        ]"
      >
        <PaperclipIcon class="text-[var(--muted)]" />
        <span class="truncate">{{ file ? file.name : "Select file" }}</span>
        <input
          ref="input"
          type="file"
          accept=".pdf,.doc,.docx"
          class="sr-only"
          :disabled="disabled || busy"
          @change="file = ($event.target as HTMLInputElement).files?.[0] ?? null"
        />
      </label>
      <button
        type="button"
        :disabled="!file || busy || disabled"
        class="rounded-full bg-[var(--bg)] px-5 py-2 text-sm font-medium shadow-sm ring-1 ring-[var(--border)] hover:bg-brand hover:text-white disabled:cursor-not-allowed disabled:text-[var(--muted)] disabled:hover:bg-[var(--bg)]"
        @click="upload"
      >
        {{ busy ? "Uploading…" : "Upload" }}
      </button>
    </div>
    <p v-if="error" class="mt-2 text-sm text-red-700 dark:text-red-300">{{ error }}</p>
    <p v-if="current" class="mt-4 flex items-center gap-4 text-sm">
      <PaperclipIcon class="text-[var(--muted)]" />
      <a v-if="current.url" :href="current.url" target="_blank" rel="noopener" class="underline">{{ current.fileName }}</a>
      <span v-else>{{ current.fileName }}</span>
      <span class="italic text-[var(--muted)]">{{ fmtWhen(current.uploadedAt) }}</span>
    </p>
  </section>
</template>
