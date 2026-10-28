<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { initials, type User } from "../lib/auth";

// Initials in a circle, top right. Opens a side panel with the user's name, email and Sign out.
const props = defineProps<{ user: User }>();

// Long addresses wrap after the @ rather than mid-word.
const emailParts = computed(() => {
  const at = props.user.email.lastIndexOf("@");
  return at > 0 ? [props.user.email.slice(0, at), props.user.email.slice(at)] : [props.user.email, ""];
});

const open = ref(false);
const trigger = ref<HTMLButtonElement>();
const closeButton = ref<HTMLButtonElement>();

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape") close();
}

function close() {
  if (!open.value) return;
  open.value = false;
  trigger.value?.focus();
}

watch(open, async (isOpen) => {
  if (isOpen) {
    document.addEventListener("keydown", onKey);
    await nextTick();
    closeButton.value?.focus();
  } else {
    document.removeEventListener("keydown", onKey);
  }
});
const route = useRoute();
watch(() => route.fullPath, close);
onBeforeUnmount(() => document.removeEventListener("keydown", onKey));
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-white hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    :aria-label="`Account: ${props.user.name}`"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :title="props.user.name"
    @click="open = true"
  >
    {{ initials(props.user) }}
  </button>

  <Teleport to="body">
    <Transition
      enter-from-class="opacity-0"
      leave-to-class="opacity-0"
      enter-active-class="transition-opacity duration-200"
      leave-active-class="transition-opacity duration-150"
    >
      <div v-if="open" class="fixed inset-0 z-[2000] bg-black/30" aria-hidden="true" @click="close" />
    </Transition>
    <Transition
      enter-from-class="translate-x-full"
      leave-to-class="translate-x-full"
      enter-active-class="transition-transform duration-200 ease-out"
      leave-active-class="transition-transform duration-150 ease-in"
    >
      <aside
        v-if="open"
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-title"
        class="fixed inset-y-0 right-0 z-[2001] flex w-80 max-w-[85vw] flex-col border-l border-[var(--border)] bg-[var(--surface)] shadow-2xl"
      >
        <div class="flex h-14 items-center justify-between border-b border-[var(--border)] px-5">
          <h2 id="account-title" class="font-semibold">Account</h2>
          <button
            ref="closeButton"
            type="button"
            aria-label="Close"
            class="flex h-8 w-8 items-center justify-center rounded-full text-lg text-[var(--muted)] hover:bg-black/5 dark:hover:bg-white/10"
            @click="close"
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div class="flex flex-col items-center gap-3 px-5 py-8 text-center">
          <span class="flex h-16 w-16 items-center justify-center rounded-full bg-brand text-xl font-semibold text-white" aria-hidden="true">
            {{ initials(props.user) }}
          </span>
          <div class="min-w-0 max-w-full">
            <p class="font-medium break-words">{{ props.user.name }}</p>
            <p class="mt-0.5 text-sm [overflow-wrap:anywhere] text-[var(--muted)]">{{ emailParts[0] }}<wbr />{{ emailParts[1] }}</p>
          </div>
        </div>


        <!-- A form POST, so a link or image elsewhere can't sign people out. -->
        <form method="post" action="/api/auth/logout" class="mt-auto border-t border-[var(--border)] p-5">
          <button
            type="submit"
            class="w-full rounded-full border border-[var(--border)] px-4 py-2 text-sm font-medium hover:bg-black/5 dark:hover:bg-white/10"
          >
            Sign out
          </button>
        </form>
      </aside>
    </Transition>
  </Teleport>
</template>
