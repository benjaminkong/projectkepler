import { createRouter, createWebHistory } from "vue-router";

const SUFFIX = " · Tender Sites Portal";

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", component: () => import("./pages/HomePage.vue") },
    { path: "/sites/:slug", component: () => import("./pages/SitePage.vue"), props: true },
    { path: "/sites/:slug/mrt", component: () => import("./pages/SiteMrtPage.vue"), props: true },
    { path: "/sites/:slug/documents", component: () => import("./pages/SiteDocumentsPage.vue"), props: true },
    { path: "/transactions", component: () => import("./pages/TransactionsPage.vue"), meta: { title: "Recent transactions" } },
    { path: "/:pathMatch(.*)*", component: () => import("./pages/NotFoundPage.vue"), meta: { title: "Not found" } },
  ],
  scrollBehavior: (to, from, saved) => saved ?? (to.path !== from.path ? { top: 0 } : undefined),
});

/** Sets the browser tab title; pages with data call it again once loaded. */
export function setTitle(title?: string) {
  document.title = title ? `${title}${SUFFIX}` : "Tender Sites Portal";
}

router.afterEach((to) => setTitle(to.meta.title as string | undefined));
