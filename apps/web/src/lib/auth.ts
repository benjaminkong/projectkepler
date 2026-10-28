import { ref } from "vue";

// Signed-in user, from the API's encrypted session cookie (SAML sign-in with Microsoft Entra ID).
export interface User {
  name: string;
  email: string;
}

export const user = ref<User | null>(null);
/** False when the API runs without SSO (local dev before Entra is set up). */
export const authEnabled = ref(false);

let loading: Promise<void> | null = null;

/** Loads the session once per page load. */
export function loadSession(): Promise<void> {
  loading ??= fetch("/api/auth/me")
    .then((res) => {
      if (!res.ok) throw new Error(`/api/auth/me answered ${res.status}`);
      return res.json() as Promise<{ enabled: boolean; user: User | null }>;
    })
    .then((body) => {
      authEnabled.value = body.enabled;
      user.value = body.user;
    })
    .catch((err) => {
      loading = null; // try again on the next navigation
      throw err;
    });
  return loading;
}

/** Full-page redirect to Entra; the API brings the browser back to `returnTo` afterwards. */
export function signIn(returnTo = location.pathname + location.search) {
  location.assign(`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
}

/** "Jane Tan" → "JT", "jane.tan@example.com" → "JT", "Madonna" → "M". */
export function initials({ name, email }: User): string {
  const words = (name.includes("@") || !name.trim() ? (name || email).split("@")[0].split(/[._-]+/) : name.split(/[\s,]+/))
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ""))
    .filter(Boolean);
  if (!words.length) return "?";
  const letters = words.length === 1 ? words[0][0] : words[0][0] + words[words.length - 1][0];
  return letters.toUpperCase();
}
