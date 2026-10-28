// SAML sign-in, end to end through Fastify. Plays Entra with a throwaway key and certificate
// (made with openssl), so the real signature checks in node-saml run.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { SignedXml } from "xml-crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { authConfigFromEnv, safeReturnTo, type AuthConfig } from "../src/auth/saml";
import { openSession, sealSession } from "../src/auth/session";

const BASE = "http://localhost:5173";
const ACS = `${BASE}/api/auth/saml/acs`;
const ISSUER = "urn:tender-sites-portal";
const IDP = "https://sts.windows.net/00000000-0000-0000-0000-000000000000/";
const SECRET = "test-secret-that-is-at-least-32-characters";

let key: string;
let cert: string;
let otherCert: string;
let app: FastifyInstance;
let config: AuthConfig;

function makeKeyPair() {
  const dir = mkdtempSync(path.join(tmpdir(), "saml-test-"));
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=test-idp",
    "-keyout", path.join(dir, "key.pem"), "-out", path.join(dir, "cert.pem")], { stdio: "ignore" });
  const pair = { key: readFileSync(path.join(dir, "key.pem"), "utf8"), cert: readFileSync(path.join(dir, "cert.pem"), "utf8") };
  rmSync(dir, { recursive: true });
  return pair;
}

beforeAll(async () => {
  ({ key, cert } = makeKeyPair());
  otherCert = makeKeyPair().cert;

  config = {
    baseUrl: BASE,
    entryPoint: "https://login.microsoftonline.com/tenant/saml2",
    logoutUrl: "https://login.microsoftonline.com/tenant/saml2",
    issuer: ISSUER,
    idpCert: cert,
    sessionSecret: SECRET,
    sessionTtlMs: 3_600_000,
  };
  app = await buildApp({ auth: config });
});

afterAll(() => app?.close());

const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();

/** A SAMLResponse shaped like Entra's: assertion signed, response not. */
function samlResponse({ email = "jane.tan@example.com", tamper = false, acs = ACS, inResponseTo = "" } = {}) {
  const irt = inResponseTo ? ` InResponseTo="${inResponseTo}"` : "";
  const xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" ID="_r${Date.now()}" Version="2.0" IssueInstant="${iso()}" Destination="${acs}"${irt}>` +
    `<Issuer xmlns="urn:oasis:names:tc:SAML:2.0:assertion">${IDP}</Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>` +
    `<Assertion xmlns="urn:oasis:names:tc:SAML:2.0:assertion" ID="_a${Date.now()}" IssueInstant="${iso()}" Version="2.0">` +
    `<Issuer>${IDP}</Issuer>` +
    `<Subject><NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress">${email}</NameID>` +
    `<SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><SubjectConfirmationData NotOnOrAfter="${iso(300_000)}" Recipient="${acs}"${irt}/></SubjectConfirmation></Subject>` +
    `<Conditions NotBefore="${iso(-60_000)}" NotOnOrAfter="${iso(3_600_000)}"><AudienceRestriction><Audience>${ISSUER}</Audience></AudienceRestriction></Conditions>` +
    `<AttributeStatement>` +
    `<Attribute Name="http://schemas.microsoft.com/identity/claims/displayname"><AttributeValue>Jane Tan</AttributeValue></Attribute>` +
    `<Attribute Name="http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"><AttributeValue>${email}</AttributeValue></Attribute>` +
    `</AttributeStatement>` +
    `<AuthnStatement AuthnInstant="${iso()}" SessionIndex="_session1"><AuthnContext><AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</AuthnContextClassRef></AuthnContext></AuthnStatement>` +
    `</Assertion></samlp:Response>`;
  const sig = new SignedXml({
    privateKey: key,
    publicCert: cert,
    signatureAlgorithm: "http://www.w3.org/2001/04/xmldsig-more#rsa-sha256",
    canonicalizationAlgorithm: "http://www.w3.org/2001/10/xml-exc-c14n#",
  });
  sig.addReference({
    xpath: "//*[local-name(.)='Assertion']",
    digestAlgorithm: "http://www.w3.org/2001/04/xmlenc#sha256",
    transforms: ["http://www.w3.org/2000/09/xmldsig#enveloped-signature", "http://www.w3.org/2001/10/xml-exc-c14n#"],
  });
  sig.computeSignature(xml, { location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: "after" } });
  let signed = sig.getSignedXml();
  if (tamper) signed = signed.replace("<AttributeValue>Jane Tan</AttributeValue>", "<AttributeValue>Mallory</AttributeValue>");
  return Buffer.from(signed).toString("base64");
}

const postAcs = (SAMLResponse: string, RelayState = "/transactions") =>
  app.inject({ method: "POST", url: "/api/auth/saml/acs", payload: new URLSearchParams({ SAMLResponse, RelayState }).toString(),
    headers: { "content-type": "application/x-www-form-urlencoded" } });

async function signIn() {
  const res = await postAcs(samlResponse());
  const cookie = res.cookies.find((c) => c.name === "tsp_session");
  expect(cookie).toBeDefined();
  return `tsp_session=${cookie!.value}`;
}

describe("gating", () => {
  it("answers 401 on API routes without a session, but leaves health and auth open", async () => {
    expect((await app.inject("/api/sites")).statusCode).toBe(401);
    expect((await app.inject("/api/health")).statusCode).toBe(200);
    expect((await app.inject("/api/auth/me")).json()).toEqual({ enabled: true, user: null });
  });

  it("serves SP metadata with the ACS URL and entity ID", async () => {
    const res = await app.inject("/api/auth/saml/metadata");
    expect(res.headers["content-type"]).toContain("application/xml");
    expect(res.body).toContain(`entityID="${ISSUER}"`);
    expect(res.body).toContain(`Location="${ACS}"`);
  });
});

describe("sign-in", () => {
  it("redirects to Entra with a SAMLRequest and the page to come back to", async () => {
    const res = await app.inject("/api/auth/login?returnTo=%2Fsites%2Fabc%3Ftab%3D1");
    expect(res.statusCode).toBe(302);
    const url = new URL(res.headers.location as string);
    expect(url.origin + url.pathname).toBe(config.entryPoint);
    expect(url.searchParams.get("SAMLRequest")).toBeTruthy();
    expect(url.searchParams.get("RelayState")).toBe("/sites/abc?tab=1");
  });

  it("never sends people off-site after sign-in", async () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "/api/auth/logout", undefined]) {
      expect(safeReturnTo(bad)).toBe("/");
    }
    const res = await app.inject("/api/auth/login?returnTo=%2F%2Fevil.example");
    expect(new URL(res.headers.location as string).searchParams.get("RelayState")).toBe("/");
  });

  it("accepts a signed response, sets the session and opens the API", async () => {
    const res = await postAcs(samlResponse());
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toBe("/transactions");
    const cookie = res.cookies.find((c) => c.name === "tsp_session")!;
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "Lax", path: "/" });

    const headers = { cookie: `tsp_session=${cookie.value}` };
    expect((await app.inject({ url: "/api/auth/me", headers })).json()).toEqual({
      enabled: true,
      user: { name: "Jane Tan", email: "jane.tan@example.com" },
    });
    // Past the gate: an unknown API path is now a 404, not a 401.
    expect((await app.inject({ url: "/api/no-such-route", headers })).statusCode).toBe(404);
  });

  it("rejects a response altered after signing", async () => {
    const res = await postAcs(samlResponse({ tamper: true }));
    expect(res.headers.location).toBe("/signed-out?error=signin");
    expect(res.cookies.find((c) => c.name === "tsp_session")).toBeUndefined();
  });

  it("rejects a response signed by another certificate", async () => {
    const other = await buildApp({ auth: { ...config, idpCert: otherCert } });
    const res = await other.inject({ method: "POST", url: "/api/auth/saml/acs",
      payload: new URLSearchParams({ SAMLResponse: samlResponse() }).toString(),
      headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.headers.location).toBe("/signed-out?error=signin");
    await other.close();
  });
});

describe("sign-in over https (several instances, e.g. Vercel)", () => {
  const HTTPS = "https://tenders.example.com";
  const HTTPS_ACS = `${HTTPS}/api/auth/saml/acs`;
  const form = (fields: Record<string, string>) => new URLSearchParams(fields).toString();
  const formHeaders = (cookie?: string) => ({ "content-type": "application/x-www-form-urlencoded", ...(cookie ? { cookie } : {}) });

  /** Starts a sign-in on one instance; returns the request ID and the cookie that remembers it. */
  async function startSignIn() {
    const a = await buildApp({ auth: { ...config, baseUrl: HTTPS } });
    const res = await a.inject("/api/auth/login?returnTo=%2Ftransactions");
    await a.close();
    const xml = inflateRawSync(Buffer.from(new URL(res.headers.location as string).searchParams.get("SAMLRequest")!, "base64")).toString();
    const cookie = res.cookies.find((c) => c.name === "tsp_saml_req")!;
    return { id: /ID="([^"]+)"/.exec(xml)![1], cookie };
  }

  it("remembers the request in a cross-site cookie and accepts the answer on another instance", async () => {
    const { id, cookie } = await startSignIn();
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "None", path: "/api/auth/saml/acs" });

    const b = await buildApp({ auth: { ...config, baseUrl: HTTPS } });
    const res = await b.inject({ method: "POST", url: "/api/auth/saml/acs", headers: formHeaders(`tsp_saml_req=${cookie.value}`),
      payload: form({ SAMLResponse: samlResponse({ acs: HTTPS_ACS, inResponseTo: id }), RelayState: "/transactions" }) });
    expect(res.headers.location).toBe("/transactions");
    expect(res.cookies.find((c) => c.name === "tsp_session")).toMatchObject({ secure: true });
    // The request ID is used up.
    expect(res.cookies.find((c) => c.name === "tsp_saml_req")?.value).toBe("");
    await b.close();
  });

  it("rejects an answer to a request this browser didn't start", async () => {
    const { id } = await startSignIn();
    const b = await buildApp({ auth: { ...config, baseUrl: HTTPS } });
    const res = await b.inject({ method: "POST", url: "/api/auth/saml/acs", headers: formHeaders(),
      payload: form({ SAMLResponse: samlResponse({ acs: HTTPS_ACS, inResponseTo: id }) }) });
    expect(res.headers.location).toBe("/signed-out?error=signin");
    await b.close();
  });

  it("still accepts a sign-in started from My Apps (no InResponseTo)", async () => {
    const b = await buildApp({ auth: { ...config, baseUrl: HTTPS } });
    const res = await b.inject({ method: "POST", url: "/api/auth/saml/acs", headers: formHeaders(),
      payload: form({ SAMLResponse: samlResponse({ acs: HTTPS_ACS }) }) });
    expect(res.headers.location).toBe("/");
    expect(res.cookies.find((c) => c.name === "tsp_session")).toBeDefined();
    await b.close();
  });
});

describe("sign-out", () => {
  it("clears the session and sends a LogoutRequest to Entra", async () => {
    const cookie = await signIn();
    const res = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { cookie, "content-type": "application/x-www-form-urlencoded" }, payload: "" });
    expect(res.statusCode).toBe(302);
    expect(res.headers.location).toMatch(/^https:\/\/login\.microsoftonline\.com\/tenant\/saml2\?SAMLRequest=/);
    expect(res.cookies.find((c) => c.name === "tsp_session")?.value).toBe("");
  });

  it("lands on /signed-out when Entra comes back", async () => {
    const res = await app.inject("/api/auth/saml/logout?SAMLResponse=x");
    expect(res.headers.location).toBe("/signed-out");
  });
});

describe("session cookie", () => {
  const user = { name: "A", email: "a@example.com", nameID: "a@example.com", nameIDFormat: "x" };

  it("round-trips, and refuses tampered, foreign or expired cookies", () => {
    const sealed = sealSession(user, SECRET, 60_000);
    expect(openSession(sealed, SECRET)).toEqual(user);
    expect(openSession(sealed.slice(0, -2) + "AA", SECRET)).toBeNull();
    expect(openSession(sealed, SECRET + "x")).toBeNull();
    expect(openSession(sealSession(user, SECRET, -1), SECRET)).toBeNull();
    expect(openSession("garbage", SECRET)).toBeNull();
    expect(openSession(undefined, SECRET)).toBeNull();
  });
});

describe("config", () => {
  it("is off without SAML_ENTRY_POINT in dev, and refuses to start that way in production", async () => {
    expect(authConfigFromEnv({ NODE_ENV: "development" })).toBeNull();
    expect(() => authConfigFromEnv({ NODE_ENV: "production" })).toThrow(/AUTH_DISABLED/);
    expect(authConfigFromEnv({ NODE_ENV: "production", AUTH_DISABLED: "1" })).toBeNull();
    expect(() => authConfigFromEnv({ SAML_ENTRY_POINT: "x", SAML_IDP_CERT: "c", SESSION_SECRET: "short" })).toThrow(/32/);

    const off = await buildApp({ auth: null });
    expect((await off.inject("/api/auth/me")).json()).toEqual({ enabled: false, user: null });
    await off.close();
  });
});
