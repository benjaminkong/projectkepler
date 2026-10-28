<script setup lang="ts">
import L from "leaflet";
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import type { LatLng } from "@tender/core/geo";
import { esc, ONEMAP_ATTRIBUTION, oneMapTileUrl, routePopupLinks, SG_BOUNDS, siteStarIcon } from "../lib/map";

export interface OverviewSite {
  slug: string;
  name: string;
  type: string;
  center: LatLng;
}

const props = defineProps<{ sites: OverviewSite[] }>();
const router = useRouter();
const el = ref<HTMLDivElement>();

const MIN_ZOOM = 10;
const FIT_OPTIONS: L.FitBoundsOptions = { maxZoom: 14 };
const siteIcon = siteStarIcon(38);

let map: L.Map | undefined;
let tiles: L.TileLayer | undefined;
let markers: L.LayerGroup | undefined;

function boundsFor(sites: OverviewSite[], pad = 0.25): L.LatLngBounds {
  return sites.length ? L.latLngBounds(sites.map((s) => [s.center.lat, s.center.lng])).pad(pad) : L.latLngBounds(SG_BOUNDS);
}

/**
 * Keeps the view on the sites. On a wide map, zooming out far enough to fit every site would
 * show past the edge of OneMap's tiles (a grey band), so don't zoom out further than the zoom at
 * which the map is filled by Singapore, unless the sites (plus room for the stars) wouldn't fit.
 */
function fit() {
  if (!map) return;
  const fillZoom = map.getBoundsZoom(SG_BOUNDS, true);
  const sitesZoom = props.sites.length ? map.getBoundsZoom(boundsFor(props.sites, 0), false, L.point(48, 48)) : fillZoom;
  map.setMinZoom(Math.max(MIN_ZOOM, Math.min(fillZoom, sitesZoom)));
  map.fitBounds(boundsFor(props.sites), FIT_OPTIONS);
}

function drawMarkers() {
  markers?.clearLayers();
  for (const s of props.sites) {
    L.marker([s.center.lat, s.center.lng], { icon: siteIcon, title: s.name })
      .bindPopup(
        `<p class="m-0 font-semibold">${esc(s.name)}</p><p class="m-0 text-xs">${esc(s.type)}</p>` +
          `<a href="/sites/${s.slug}" data-route class="mt-1 inline-block font-medium">View neighbourhood →</a>`,
      )
      .addTo(markers!);
  }
}

onMounted(() => {
  map = L.map(el.value!, { maxBounds: SG_BOUNDS, minZoom: MIN_ZOOM, maxZoom: 19, scrollWheelZoom: false });
  tiles = L.tileLayer(oneMapTileUrl.value, { attribution: ONEMAP_ATTRIBUTION, detectRetina: true }).addTo(map);
  markers = L.layerGroup().addTo(map);
  map.fitBounds(boundsFor(props.sites), FIT_OPTIONS);
  routePopupLinks(map, (p) => router.push(p));
  drawMarkers();
  fit();
  map.on("resize", fit);
});

// Refit only when the set of sites changes (e.g. the status filter).
watch(
  () => props.sites.map((s) => s.slug).join(","),
  () => {
    drawMarkers();
    fit();
  },
);
watch(oneMapTileUrl, (url) => tiles?.setUrl(url));

onBeforeUnmount(() => map?.remove());
</script>

<template>
  <div ref="el" class="h-full w-full" />
</template>
