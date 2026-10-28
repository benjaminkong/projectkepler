<script setup lang="ts">
import L from "leaflet";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { CATEGORIES, CATEGORY_BY_ID, type CategoryId } from "@tender/core/categories";
import { describeDistance, FALLBACK_RADIUS_M, PRIMARY_RADIUS_M, type NearbyResult } from "@tender/core/nearby";
import { esc, ONEMAP_ATTRIBUTION, oneMapTileUrl, SG_BOUNDS, siteStarIcon } from "../lib/map";
import { placeKey, type ExplorerSite, type FocusTarget } from "./explorer";

const props = defineProps<{
  site: ExplorerSite;
  nearby: Record<CategoryId, NearbyResult>;
  /** Places the user unticked, as placeKey() values. */
  hidden: Set<string>;
  focus: FocusTarget;
}>();

/** Opening zoom for the site map: 16 shows the parcel and the nearest places. */
const DEFAULT_ZOOM = 16;
const MIN_ZOOM = 10;
/** OneMap tiles stop at 19, so 20 is an upscaled 19. */
const MAX_ZOOM = 20;
const ONEMAP_MAX_NATIVE_ZOOM = 19;
// At zoom 10 (MIN_ZOOM) the view is wider than Singapore, so allow panning past SG_BOUNDS;
// otherwise Leaflet would shift the map off-centre from the site.
const PAN_BOUNDS = L.latLngBounds(SG_BOUNDS).pad(1);

const icons = Object.fromEntries(
  CATEGORIES.map((c) => [
    c.id,
    L.divIcon({
      className: "",
      html: `<div class="poi-marker" style="width:26px;height:26px;background:${c.color}">${c.glyph}</div>`,
      iconSize: [26, 26],
      iconAnchor: [13, 13],
      popupAnchor: [0, -13],
    }),
  ]),
) as Record<CategoryId, L.DivIcon>;

const el = ref<HTMLDivElement>();
const actions = ref<HTMLDivElement>();
let map: L.Map | undefined;
let tiles: L.TileLayer | undefined;
let widenedRing: L.Circle | undefined;
const markers = new Map<string, L.Marker>();

function center(): L.LatLngTuple {
  return [props.site.center.lat, props.site.center.lng];
}

/** Adds ticked places to the map and removes unticked ones; shows the 2 km ring only for widened places on the map (FR-2.3). */
function syncVisible() {
  if (!map) return;
  let widened = false;
  for (const c of CATEGORIES) {
    props.nearby[c.id].items.forEach((_, i) => {
      const key = placeKey(c.id, i);
      const m = markers.get(key)!;
      const show = !props.hidden.has(key);
      if (show && !map!.hasLayer(m)) m.addTo(map!);
      if (!show && map!.hasLayer(m)) m.remove();
      if (show && props.nearby[c.id].widened) widened = true;
    });
  }
  if (widened && !map.hasLayer(widenedRing!)) widenedRing!.addTo(map);
  if (!widened && map.hasLayer(widenedRing!)) widenedRing!.remove();
}

onMounted(() => {
  map = L.map(el.value!, { center: center(), zoom: DEFAULT_ZOOM, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM, maxBounds: PAN_BOUNDS });
  // No detectRetina: on retina screens it shifts tiles one zoom up and caps the layer at 19,
  // which leaves the map blank at zoom 20.
  tiles = L.tileLayer(oneMapTileUrl.value, {
    attribution: ONEMAP_ATTRIBUTION,
    maxNativeZoom: ONEMAP_MAX_NATIVE_ZOOM,
    maxZoom: MAX_ZOOM,
  }).addTo(map);

  // Top-right controls (Nearby MRT link and recentre), rendered by the template and moved into Leaflet's corner.
  const corner = el.value!.querySelector(".leaflet-top.leaflet-right")!;
  for (const node of [...actions.value!.children]) corner.appendChild(node);
  L.DomEvent.disableClickPropagation(corner as HTMLElement);

  L.circle(center(), { radius: PRIMARY_RADIUS_M, color: "#0f766e", weight: 2, fillOpacity: 0.04, dashArray: "6 6" }).addTo(map);
  widenedRing = L.circle(center(), { radius: FALLBACK_RADIUS_M, color: "#d97706", weight: 2, fillOpacity: 0.02, dashArray: "4 8" });

  for (const poly of props.site.parcel ?? []) {
    const positions = poly.map((ring) => ring.map(([lng, lat]) => [lat, lng] as L.LatLngTuple));
    L.polygon(positions, { color: "#0f766e", weight: 3, fillOpacity: 0.35 }).addTo(map);
  }
  L.marker(center(), { icon: siteStarIcon(52), zIndexOffset: 1000, title: props.site.name })
    .bindPopup(`<strong>${esc(props.site.name)}</strong><br />Tender site`)
    .addTo(map);

  for (const { id } of CATEGORIES) {
    const cat = CATEGORY_BY_ID[id];
    props.nearby[id].items.forEach((p, i) => {
      const popup =
        `<span class="text-xs font-semibold uppercase" style="color:${cat.color}">${esc(cat.label)}</span><br />` +
        `<strong>${esc(p.name)}</strong><br />${esc(describeDistance(p))} from site` +
        (p.detail ? `<br /><span class="text-xs opacity-75">${esc(p.detail)}</span>` : "");
      markers.set(placeKey(id, i), L.marker([p.lat, p.lng], { icon: icons[id], title: p.name }).bindPopup(popup));
    });
  }
  syncVisible();
});

function recentre() {
  map?.setView(center(), DEFAULT_ZOOM);
}

watch(() => props.hidden, syncVisible);
watch(oneMapTileUrl, (url) => tiles?.setUrl(url));

// FR-2.11: clicking an item in the side list opens its marker.
watch(
  () => props.focus,
  (focus) => {
    if (!focus || !map) return;
    const marker = markers.get(placeKey(focus.category, focus.index));
    if (!marker) return;
    map.flyTo(marker.getLatLng(), Math.max(map.getZoom(), 17), { duration: 0.6 });
    marker.openPopup();
  },
);

onBeforeUnmount(() => map?.remove());
</script>

<template>
  <div ref="el" class="h-full w-full" />
  <div ref="actions" class="hidden">
    <div class="leaflet-control">
      <RouterLink
        :to="`/sites/${site.slug}/mrt`"
        class="flex items-center gap-1.5 rounded-full border-2 border-white bg-[#d42e12] px-3 py-1.5 text-xs font-semibold !text-white shadow-md hover:bg-[#b0240e]"
      >
        <span aria-hidden="true" class="grid h-4 w-4 place-items-center rounded-full bg-white text-[9px] font-bold text-[#d42e12]">M</span>
        Nearby MRT
      </RouterLink>
    </div>
    <div class="leaflet-control leaflet-bar">
      <a href="#" role="button" title="Recentre on site" aria-label="Recentre on site" @click.prevent="recentre">⌖</a>
    </div>
  </div>
</template>
