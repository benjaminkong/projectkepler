// Vercel entry: api/index.mjs re-exports this handler, and vercel.json rewrites /api/* to it.
// Vercel serves the built Vue app itself, so Fastify only answers /api routes here.
import type { IncomingMessage, ServerResponse } from "node:http";
import "./env";
import { buildApp } from "./app";

// Built once per function instance and reused while the instance stays warm.
const ready = buildApp().then(async (app) => {
  await app.ready();
  return app;
});

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const app = await ready;
  app.server.emit("request", req, res);
}
