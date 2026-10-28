import { computed, ref, watchEffect } from "vue";

// Light/dark mode: "system" follows the OS. index.html applies it before first paint.
type Choice = "light" | "dark" | "system";
const read = (): Choice => {
  try {
    const t = localStorage.getItem("theme");
    return t === "light" || t === "dark" ? t : "system";
  } catch {
    return "system";
  }
};

const choice = ref<Choice>(read());
const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(media.matches);
media.addEventListener("change", (e) => (systemDark.value = e.matches));

export const isDark = computed(() => (choice.value === "system" ? systemDark.value : choice.value === "dark"));

watchEffect(() => document.documentElement.classList.toggle("dark", isDark.value));

export function toggleTheme() {
  choice.value = isDark.value ? "light" : "dark";
  try {
    localStorage.setItem("theme", choice.value);
  } catch {
    // private mode: the choice lasts for this visit only
  }
}
