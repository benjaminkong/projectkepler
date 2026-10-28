<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from "vue";

export interface Option {
  value: string;
  label: string;
}

const props = defineProps<{
  /** Form field name; one hidden input is rendered per selected value. */
  name: string;
  label: string;
  options: Option[];
  placeholder: string;
  loading?: boolean;
  disabledText?: string;
}>();
const selected = defineModel<string[]>({ required: true });
/** Fired when the dropdown opens, e.g. to load options lazily. */
const emit = defineEmits<{ open: [] }>();

/** Long lists (e.g. ~3,800 projects) render only the first matches; typing narrows them. */
const MAX_VISIBLE = 200;

const open = ref(false);
const query = ref("");
const root = ref<HTMLDivElement>();
const search = ref<HTMLInputElement>();
const listId = useId();

const selectedSet = computed(() => new Set(selected.value));
const labelOf = computed(() => new Map(props.options.map((o) => [o.value, o.label])));
// Show chips in list order, not click order.
const chips = computed(() => {
  const order = new Map(props.options.map((o, i) => [o.value, i]));
  return [...selected.value].sort((a, b) => (order.get(a) ?? Infinity) - (order.get(b) ?? Infinity));
});
const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  return q ? props.options.filter((o) => o.label.toLowerCase().includes(q)) : props.options;
});

const toggle = (value: string) =>
  (selected.value = selectedSet.value.has(value) ? selected.value.filter((v) => v !== value) : [...selected.value, value]);

function onToggleOpen() {
  if (!open.value) emit("open");
  open.value = !open.value;
}

// Close on outside click or Escape.
const onDown = (e: MouseEvent) => {
  if (!root.value?.contains(e.target as Node)) open.value = false;
};
const onKey = (e: KeyboardEvent) => {
  if (e.key === "Escape") open.value = false;
};
watch(open, (isOpen) => {
  if (isOpen) {
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    nextTick(() => search.value?.focus());
  } else {
    document.removeEventListener("mousedown", onDown);
    document.removeEventListener("keydown", onKey);
  }
});
onBeforeUnmount(() => {
  document.removeEventListener("mousedown", onDown);
  document.removeEventListener("keydown", onKey);
});
</script>

<template>
  <div ref="root" class="relative space-y-1 text-xs font-medium">
    <span>{{ label }}</span>
    <input v-for="v in selected" :key="v" type="hidden" :name="name" :value="v" />

    <button
      type="button"
      :disabled="Boolean(disabledText)"
      aria-haspopup="listbox"
      :aria-expanded="open"
      :aria-controls="listId"
      class="flex min-h-[38px] w-full items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-left text-sm font-normal outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 disabled:opacity-60"
      @click="onToggleOpen"
    >
      <span class="flex min-w-0 flex-1 flex-wrap gap-1">
        <span v-if="selected.length === 0" class="px-1 text-[var(--muted)]">{{ disabledText ?? placeholder }}</span>
        <span
          v-for="v in chips.slice(0, 3)"
          :key="v"
          class="max-w-full truncate rounded-md bg-teal-50 px-1.5 py-0.5 text-xs text-teal-900 dark:bg-teal-400/15 dark:text-teal-100"
        >
          {{ labelOf.get(v) ?? v }}
        </span>
        <span v-if="selected.length > 3" class="rounded-md px-1.5 py-0.5 text-xs text-[var(--muted)]">+{{ selected.length - 3 }} more</span>
      </span>
      <span class="text-[var(--muted)]" aria-hidden="true">▾</span>
    </button>

    <div v-if="open" class="absolute left-0 right-0 z-30 mt-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 font-normal shadow-lg">
      <div class="mb-2 flex gap-2">
        <input
          ref="search"
          v-model="query"
          placeholder="Search…"
          class="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-sm outline-none focus:border-brand"
        />
        <button v-if="selected.length > 0" type="button" class="shrink-0 px-1 text-xs underline" @click="selected = []">Clear</button>
      </div>
      <ul :id="listId" role="listbox" aria-multiselectable="true" :aria-label="label" class="max-h-64 overflow-y-auto">
        <li v-if="loading" class="px-2 py-1.5 text-sm text-[var(--muted)]">Loading…</li>
        <template v-else>
          <li v-if="matches.length === 0" class="px-2 py-1.5 text-sm text-[var(--muted)]">No matches</li>
          <li v-for="o in matches.slice(0, MAX_VISIBLE)" :key="o.value" role="option" :aria-selected="selectedSet.has(o.value)">
            <label class="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-sm hover:bg-black/5 dark:hover:bg-white/5">
              <input type="checkbox" :checked="selectedSet.has(o.value)" class="h-3.5 w-3.5 accent-teal-700" @change="toggle(o.value)" />
              <span class="truncate">{{ o.label }}</span>
            </label>
          </li>
          <li v-if="matches.length > MAX_VISIBLE" class="px-2 py-1.5 text-xs text-[var(--muted)]">
            Showing {{ MAX_VISIBLE }} of {{ matches.length.toLocaleString("en-SG") }}. Type to narrow the list.
          </li>
        </template>
      </ul>
    </div>
  </div>
</template>
