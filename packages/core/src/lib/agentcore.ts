// Tender documents (COT / TCOT) via the GI AI Agent Orchestrator on Amazon Bedrock AgentCore.
// Flow: get an OAuth access token from Cognito, then invoke the AgentCore runtime with a JSON
// input; the input decides the action (presigned upload URL, list documents, generate, ...).
// Server-only: client secret and tokens never reach the browser.
//
// Env:
//   COGNITO_TOKEN_URL      https://my-domain-poenhrym.auth.ap-southeast-1.amazoncognito.com/oauth2/token
//   COGNITO_CLIENT_ID      app client id
//   COGNITO_CLIENT_SECRET  app client secret
//   COGNITO_SCOPE          optional, space-separated
//   AGENTCORE_RUNTIME_URL  https://bedrock-agentcore.ap-southeast-1.amazonaws.com/runtimes/<escaped ARN>/invocations

export type DocType = "COT" | "TCOT";
export const DOC_TYPES: DocType[] = ["COT", "TCOT"];

export class NotConfiguredError extends Error {}

/** An error reply from the AgentCore runtime, with a message fit to show users. */
export class AgentError extends Error {
  constructor(
    readonly status: number,
    readonly userMessage: string,
    detail: string,
  ) {
    super(`AgentCore ${status}: ${detail}`);
  }
}

/** AgentCore 424: the runtime's container did not start within AWS's 30 s limit (a cold start). */
const isColdStartFailure = (status: number, body: string) => status === 424 && /initiali[sz]ation/i.test(body);

export interface StoredDocument {
  fileName: string;
  /** ISO timestamp or the API's own date text. */
  uploadedAt?: string;
  /** Optional link to view/download. */
  url?: string;
}

export interface PresignedUpload {
  url: string;
  method: "PUT" | "POST";
  /** Headers the browser must send with a PUT (e.g. Content-Type). */
  headers?: Record<string, string>;
  /** Form fields for an S3 presigned POST. */
  fields?: Record<string, string>;
}

export function documentsConfigured(): boolean {
  return Boolean(
    process.env.COGNITO_TOKEN_URL && process.env.COGNITO_CLIENT_ID && process.env.COGNITO_CLIENT_SECRET && process.env.AGENTCORE_RUNTIME_URL,
  );
}

// --- Cognito access token (client credentials), cached until shortly before it expires ----------

const g = globalThis as typeof globalThis & { __cognitoToken?: { value: string; expiresAt: number } };

export async function getAccessToken(): Promise<string> {
  if (!documentsConfigured()) throw new NotConfiguredError("Tender document service is not configured.");
  const cached = g.__cognitoToken;
  if (cached && Date.now() < cached.expiresAt - 60_000) return cached.value;

  const body = new URLSearchParams({ grant_type: "client_credentials" });
  if (process.env.COGNITO_SCOPE) body.set("scope", process.env.COGNITO_SCOPE);
  const basic = Buffer.from(`${process.env.COGNITO_CLIENT_ID}:${process.env.COGNITO_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(process.env.COGNITO_TOKEN_URL!, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error?: string };
  if (!res.ok || !json.access_token) throw new Error(`Cognito token request failed: ${res.status} ${json.error ?? ""}`.trim());
  g.__cognitoToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

// --- AgentCore runtime invocation --------------------------------------------------------------

/** Invokes the orchestrator runtime with one action. `local` adds the X-Agentcore-Local header the file actions use. */
export async function invokeAgent<T = unknown>(input: Record<string, unknown>, opts: { local?: boolean; timeoutMs?: number } = {}): Promise<T> {
  const token = await getAccessToken();
  const started = Date.now();
  for (let attempt = 1; ; attempt++) {
    const remaining = opts.timeoutMs ? opts.timeoutMs - (Date.now() - started) : undefined;
    const res = await fetch(process.env.AGENTCORE_RUNTIME_URL!, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(opts.local ? { "X-Agentcore-Local": "1" } : {}),
      },
      body: JSON.stringify(input),
      cache: "no-store",
      signal: remaining ? AbortSignal.timeout(Math.max(remaining, 1000)) : undefined,
    });
    const text = await res.text();
    if (res.ok) {
      try {
        return JSON.parse(text) as T;
      } catch {
        return text as T;
      }
    }
    // A cold start often succeeds on the second try, once the runtime is warm.
    if (isColdStartFailure(res.status, text) && attempt === 1) {
      console.warn(`[agentcore] ${String(input.action)}: runtime cold start timed out (424); retrying once`);
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }
    const userMessage = isColdStartFailure(res.status, text)
      ? "The report agent took too long to start (AgentCore 424). Please try again in a minute; if it keeps happening, the agent team needs to shorten its start-up time."
      : `The report agent returned an error (${res.status}).`;
    throw new AgentError(res.status, userMessage, `${String(input.action)}: ${text.slice(0, 300)}`);
  }
}

// --- Actions (from the "AI Development_Sharing" Postman collection) ----------------------------

/** S3 object as the agent describes it. */
interface AgentFile {
  key: string;
  filename: string;
  last_modified?: string;
  size?: number;
  download_url?: string;
}

const toStored = (f: AgentFile): StoredDocument => ({ fileName: f.filename, uploadedAt: f.last_modified, url: f.download_url });

/** Asks the agent for a presigned URL to upload one COT/TCOT file for a site (plain HTTP PUT). */
export async function requestUploadUrl(args: { site: string; docType: DocType; fileName: string }): Promise<PresignedUpload> {
  const r = await invokeAgent<{ upload_url?: string; key?: string }>(
    { action: "get_upload_url", tender_slug: args.site, doc_type: args.docType.toLowerCase(), filename: args.fileName },
    { local: true },
  );
  if (!r.upload_url) throw new Error("The agent did not return an upload URL.");
  return { url: r.upload_url, method: "PUT" };
}

/** Uploads a file: presigned URL from the agent first, then PUT to S3 from the server (the bucket has no browser CORS). */
export async function uploadDocument(args: { site: string; docType: DocType; fileName: string; body: ArrayBuffer; contentType: string }) {
  const { url } = await requestUploadUrl(args);
  const res = await fetch(url, { method: "PUT", body: args.body, headers: { "Content-Type": args.contentType } });
  if (!res.ok) throw new Error(`S3 upload failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
}

/** The COT and TCOT currently uploaded for a site. */
export async function listUploaded(site: string): Promise<Partial<Record<DocType, StoredDocument>>> {
  const r = await invokeAgent<{ cot?: AgentFile | null; tcot?: AgentFile | null }>(
    { action: "list_dropzone_files", tender_slug: site },
    { local: true },
  );
  return { COT: r.cot ? toStored(r.cot) : undefined, TCOT: r.tcot ? toStored(r.tcot) : undefined };
}

/** Reports the agent has generated for a site, newest first, each with a 1-hour download link. */
export async function listGenerated(site: string): Promise<StoredDocument[]> {
  const r = await invokeAgent<{ reports?: AgentFile[] }>({ action: "list_output_files", tender_slug: site }, { local: true });
  return (r.reports ?? [])
    .map(toStored)
    .sort((a, b) => (b.uploadedAt ?? "").localeCompare(a.uploadedAt ?? ""));
}

/** Runs report generation for a site (requires both COT and TCOT uploaded). Returns the agent's reply. */
export async function generate(site: string, timeoutMs?: number): Promise<unknown> {
  return invokeAgent({ action: "generate_report", tender_slug: site }, { timeoutMs });
}
