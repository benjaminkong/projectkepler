import { existsSync } from "node:fs";
import cookie from "@fastify/cookie";
import multipart from "@fastify/multipart";
import Fastify from "fastify";
import { WEB_DIST } from "./env";
import { authConfigFromEnv, authPlugin, type AuthConfig } from "./auth/saml";
import { MAX_UPLOAD_BYTES } from "@tender/core/limits";
import { documentRoutes } from "./routes/documents";
import { siteRoutes } from "./routes/sites";
import { transactionRoutes } from "./routes/transactions";
import { valuationRoutes } from "./routes/valuation";

/** `auth` defaults to the SAML settings in the environment; pass null to turn sign-in off (tests). */
export async function buildApp({ auth = authConfigFromEnv() }: { auth?: AuthConfig | null } = {}) {
  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? "info" },
    // Behind App Runner / an ALB: trust X-Forwarded-* for client IPs and protocol.
    trustProxy: true,
  });

  await app.register(cookie);
  // Before the routes: its onRequest hook answers 401 on /api/* without a session.
  await authPlugin(app, auth);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } });

  app.get("/api/health", async () => ({ status: "ok", time: new Date().toISOString() }));
  await app.register(siteRoutes);
  await app.register(valuationRoutes);
  await app.register(documentRoutes);
  await app.register(transactionRoutes);

  // Production: serve the built Vue app, and index.html for any non-API path (client-side routes).
  // Not on Vercel, whose CDN serves the app. Loaded only when needed: @fastify/static require()s an
  // ES-module-only package, which Vercel's function runtime can't load.
  const serveWeb = !process.env.VERCEL && !!WEB_DIST && existsSync(WEB_DIST);
  if (serveWeb) {
    const { default: fastifyStatic } = await import("@fastify/static");
    await app.register(fastifyStatic, { root: WEB_DIST, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    if (!serveWeb || req.url.startsWith("/api/") || req.method !== "GET") {
      return reply.code(404).send({ error: "Not found" });
    }
    return reply.type("text/html").sendFile("index.html");
  });

  return app;
}
