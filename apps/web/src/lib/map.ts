import L from "leaflet";
import { computed } from "vue";
import { isDark } from "./theme";

export const ONEMAP_ATTRIBUTION =
  '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" style="height:20px;width:20px;display:inline" alt=""/>&nbsp;<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a>&nbsp;&copy;&nbsp;contributors&nbsp;&#124;&nbsp;<a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>';

/** OneMap basemap URL that matches the app theme (FR-3.3). */
export const oneMapTileUrl = computed(
  () => `https://www.onemap.gov.sg/maps/tiles/${isDark.value ? "Night" : "Default"}/{z}/{x}/{y}.png`,
);

export const SG_BOUNDS: [[number, number], [number, number]] = [
  [1.144, 103.535],
  [1.494, 104.131],
];

// Five-point star in a 24x24 box.
export const STAR_PATH = "M12 1.6l3.1 6.3 6.9 1-5 4.9 1.2 6.9L12 17.4l-6.2 3.3L7 13.8 2 8.9l6.9-1z";

/** Gold star with a pulsing halo, used for tender sites so they stand out from amenity markers. */
export function siteStarIcon(size: number) {
  const box = Math.round(size * 1.6); // room for the halo
  return L.divIcon({
    className: "",
    html: `<div class="site-star" style="width:${box}px;height:${box}px">
      <span class="site-star-disc"></span>
      <span class="site-star-halo"></span>
      <svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">
        <path d="${STAR_PATH}" fill="none" stroke="#fff" stroke-width="3.5" stroke-linejoin="round"/>
        <path d="${STAR_PATH}" fill="#fbbf24" stroke="#92400e" stroke-width="1.2" stroke-linejoin="round"/>
      </svg>
    </div>`,
    iconSize: [box, box],
    iconAnchor: [box / 2, box / 2],
    popupAnchor: [0, -size / 2],
  });
}

const escapeMap: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
/** Escapes text for Leaflet popup HTML (place names come from external datasets). */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => escapeMap[c]);

/**
 * Popup links marked data-route navigate inside the app instead of reloading the page.
 * Call once per map with the router's push.
 */
export function routePopupLinks(map: L.Map, push: (path: string) => unknown) {
  map.getContainer().addEventListener("click", (e) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>("a[data-route]");
    if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
    e.preventDefault();
    push(a.getAttribute("href")!);
  });
}
