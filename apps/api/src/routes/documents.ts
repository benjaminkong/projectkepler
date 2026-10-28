import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  AgentError,
  DOC_TYPES,
  documentsConfigured,
  generate,
  listGenerated,
  listUploaded,
  NotConfiguredError,
  uploadDocument,
  type DocType,
} from "@tender/core/agentcore";
import { MAX_UPLOAD_BYTES } from "@tender/core/limits";
import { siteOr404 } from "./http";

type SlugParams = { Params: { slug: string } };

const ALLOWED = /\.(pdf|docx?)$/i;

/**
 * How long Generate waits for the agent before replying 202 and letting the page poll the
 * generated-files list. Keep it under the load balancer's request timeout (App Runner: 120 s).
 */
const GENERATE_WAIT_MS = Number(process.env.GENERATE_WAIT_MS) || 100_000;

function agentFailure(req: FastifyRequest, reply: FastifyReply, err: unknown, what: string, fallback: string, extra: object = {}) {
  if (err instanceof NotConfiguredError) return reply.code(503).send({ ...extra, error: err.message });
  if (err instanceof AgentError) {
    req.log.error(`[documents] ${what} failed: ${err.message}`);
    return reply.code(502).send({ ...extra, error: err.userMessage });
  }
  req.log.error(err, `[documents] ${what} failed`);
  return reply.code(502).send({ ...extra, error: fallback });
}

export async function documentRoutes(app: FastifyInstance) {
  /** GET /api/sites/:slug/documents -> { configured, uploaded: {COT?, TCOT?}, generated: [...] } */
  app.get<SlugParams>("/api/sites/:slug/documents", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply);
    if (!site) return reply;
    if (!documentsConfigured()) {
      return reply.code(503).send({ configured: false, error: "Tender document service is not configured." });
    }
    try {
      const [uploaded, generated] = await Promise.all([listUploaded(site.slug), listGenerated(site.slug)]);
      return { configured: true, uploaded, generated };
    } catch (err) {
      if (err instanceof NotConfiguredError) return reply.code(503).send({ configured: false, error: err.message });
      return agentFailure(req, reply, err, "list", "Could not load documents.", { configured: true });
    }
  });

  /**
   * POST /api/sites/:slug/documents/upload (multipart: docType=COT|TCOT, file)
   * Gets a presigned URL from the agent, then PUTs the file to S3 from the server.
   */
  app.post<SlugParams>("/api/sites/:slug/documents/upload", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply);
    if (!site) return reply;

    let docType: unknown;
    let file: { name: string; type: string; body: Buffer } | undefined;
    try {
      for await (const part of req.parts()) {
        if (part.type === "field" && part.fieldname === "docType") docType = part.value;
        else if (part.type === "file" && part.fieldname === "file") {
          file = { name: part.filename, type: part.mimetype, body: await part.toBuffer() };
        }
      }
    } catch (err) {
      if ((err as { code?: string }).code === "FST_REQ_FILE_TOO_LARGE") {
        return reply.code(413).send({ error: `Files must be ${MAX_UPLOAD_BYTES / 1024 / 1024} MB or smaller.` });
      }
      return reply.code(400).send({ error: "Could not read the upload." });
    }

    if (!DOC_TYPES.includes(docType as DocType)) return reply.code(400).send({ error: "docType must be COT or TCOT" });
    if (!file || file.body.length === 0) return reply.code(400).send({ error: "Choose a file to upload." });
    const fileName = file.name.split(/[\\/]/).pop()!.slice(0, 200);
    if (!ALLOWED.test(fileName)) return reply.code(400).send({ error: "Upload a PDF or Word document." });

    try {
      const body = file.body.buffer.slice(file.body.byteOffset, file.body.byteOffset + file.body.byteLength) as ArrayBuffer;
      await uploadDocument({ site: site.slug, docType: docType as DocType, fileName, body, contentType: file.type || "application/octet-stream" });
      return { ok: true };
    } catch (err) {
      return agentFailure(req, reply, err, "upload", "Upload failed. Try again.");
    }
  });

  /** POST /api/sites/:slug/documents/generate -> runs generate_report (needs COT and TCOT uploaded). */
  app.post<SlugParams>("/api/sites/:slug/documents/generate", async (req, reply) => {
    const site = await siteOr404(req.params.slug, reply);
    if (!site) return reply;
    try {
      const uploaded = await listUploaded(site.slug);
      if (!uploaded.COT || !uploaded.TCOT) {
        return reply.code(409).send({ error: "Upload both COT and TCOT before generating." });
      }
      const result = await generate(site.slug, GENERATE_WAIT_MS);
      return { ok: true, done: true, reply: result };
    } catch (err) {
      if ((err as Error).name === "TimeoutError") return reply.code(202).send({ ok: true, done: false });
      return agentFailure(req, reply, err, "generate", "Could not generate the report.");
    }
  });
}
