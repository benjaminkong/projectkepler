import { ref } from "vue";
import { api, ApiError } from "./api";
import { setTitle } from "../router";

/** Loads one API resource for a site page; `notFound` is set on a 404 so the page can show the not-found view. */
export function useSiteResource<T>(path: string, title: (data: T) => string) {
  const data = ref<T | null>(null);
  const error = ref<string | null>(null);
  const notFound = ref(false);
  api<T>(path)
    .then((d) => {
      data.value = d;
      setTitle(title(d));
    })
    .catch((e: Error) => {
      if (e instanceof ApiError && e.status === 404) {
        notFound.value = true;
        setTitle("Site not found");
      } else error.value = e.message;
    });
  return { data, error, notFound };
}
