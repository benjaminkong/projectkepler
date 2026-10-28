// Single sign-on with Microsoft Entra ID over SAML 2.0. Entra is the identity provider (IdP), this
// API is the service provider (SP). The README's "Single sign-on" section covers the Entra setup.
//
//   GET  /api/auth/login?returnTo=/path   Redirects to Entra; RelayState carries returnTo
//   POST /api/auth/saml/acs               Entra posts the SAMLResponse here (the Reply URL)
//   GET  /api/auth/me                     { enabled, user }
//   POST /api/auth/logout                 Clears the session, then signs out of Entra
//   *    /api/auth/saml/logout            Entra's Logout URL: lands on /signed-out
//   GET  /api/auth/saml/metadata          SP metadata, which Entra can import
//
// Every other /api route except /api/health answers 401 without a session.
import formbody from "@fastify/formbody";
import { SAML, ValidateInResponseTo, type Profile, type SamlConfig } from "@node-saml/node-saml";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { cookieRequestCache } from "./requestCache";
import { openSession, sealSession, type SessionUser } from "./session";

export interface AuthConfig {
  /** Public origin the browser uses, e.g. http://localhost:5173 or https://tenders.example.com. */
  baseUrl: string;
  /** Entra "Login URL". */
  entryPoint: string;
  /** Entra "Logout URL". Without it, signing out only clears this app's session. */
  logoutUrl?: string;
  /** Entra "Identifier (Entity ID)" of this app. */
  issuer: string;
  /** Entra's SAML signing certificate (Base64, with or without the PEM header). */
  idpCert: string;
  sessionSecret: string;
  sessionTtlMs: number;
}

const COOKIE = "tsp_session";
const PUBLIC_PATHS = ["/api/health", "/api/auth/"];

const CLAIM = {
  displayName: "http://schemas.microsoft.com/identity/claims/displayname",
  email: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
  givenName: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname",
  surname: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname",
  upn: "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name",
};

declare module "fastify" {
  interface FastifyRequest {
    user?: SessionUser;
  }
}

/**
 * Reads the SAML settings from the environment. Returns null (auth off) when SAML_ENTRY_POINT is
 * unset, which production only allows with AUTH_DISABLED=1.
 */
export function authConfigFromEnv(env = process.env): AuthConfig | null {
  if (env.AUTH_DISABLED === "1") return null;
  if (!env.SAML_ENTRY_POINT) {
    if (env.NODE_ENV === "production") {
      throw new Error("SAML_ENTRY_POINT is not set. Configure SSO or set AUTH_DISABLED=1 to run without sign-in.");
    }
    console.warn("[auth] SAML_ENTRY_POINT is not set: sign-in is OFF and every API route is open (dev only).");
    return null;
  }
  const missing = ["SAML_IDP_CERT", "SESSION_SECRET"].filter((k) => !env[k]);
  if (missing.length) throw new Error(`SSO is configured but ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} not set.`);
  if (env.SESSION_SECRET!.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters.");
  return {
    baseUrl: (env.APP_BASE_URL || "http://localhost:5173").replace(/\/+$/, ""),
    entryPoint: env.SAML_ENTRY_POINT,
    logoutUrl: env.SAML_LOGOUT_URL || undefined,
    issuer: env.SAML_ISSUER || "urn:tender-sites-portal",
    idpCert: env.SAML_IDP_CERT!.replace(/\\n/g, "\n"),
    sessionSecret: env.SESSION_SECRET!,
    sessionTtlMs: (Number(env.SESSION_HOURS) || 8) * 3_600_000,
  };
}

/** Only same-site paths, so RelayState can't send someone to another site after sign-in. */
export const safeReturnTo = (v: unknown): string =>
  typeof v === "string" && v.startsWith("/") && !v.startsWith("//") && !v.startsWith("/\\") && !v.startsWith("/api/") ? v : "/";

const first = (v: unknown): string | undefined => {
  const x = Array.isArray(v) ? v[0] : v;
  return typeof x === "string" && x.trim() ? x.trim() : undefined;
};

export function userFromProfile(p: Profile): SessionUser {
  const email = first(p[CLAIM.email]) ?? first(p.email) ?? first(p.mail) ?? first(p[CLAIM.upn]) ?? p.nameID;
  const fullName = [first(p[CLAIM.givenName]), first(p[CLAIM.surname])].filter(Boolean).join(" ");
  return {
    name: first(p[CLAIM.displayName]) ?? (fullName || email),
    email,
    nameID: p.nameID,
    nameIDFormat: p.nameIDFormat,
    sessionIndex: p.sessionIndex,
  };
}

export async function authPlugin(app: FastifyInstance, config: AuthConfig | null) {
  const user = (req: FastifyRequest) => (config ? openSession(req.cookies[COOKIE], config.sessionSecret) : null);

  app.get("/api/auth/me", async (req) => {
    const u = user(req);
    return { enabled: !!config, user: u && publicUser(u) };
  });
  if (!config) return;

  const secure = config.baseUrl.startsWith("https://");
  const cookieOpts = { path: "/", httpOnly: true, sameSite: "lax" as const, secure };
  const options: SamlConfig = {
    entryPoint: config.entryPoint,
    logoutUrl: config.logoutUrl ?? config.entryPoint,
    issuer: config.issuer,
    idpCert: config.idpCert,
    callbackUrl: `${config.baseUrl}/api/auth/saml/acs`,
    logoutCallbackUrl: `${config.baseUrl}/api/auth/saml/logout`,
    // Entra signs the assertion (not the whole response) by default.
    wantAssertionsSigned: true,
    wantAuthnResponseSigned: false,
    // Let Entra pick the method (password, passkey, MFA); a requested context causes AADSTS75011.
    disableRequestedAuthnContext: true,
    identifierFormat: null,
    // A response must answer a request this browser started. "ifPresent" still accepts sign-ins
    // started from Entra (the My Apps tile with no Sign on URL), which carry no InResponseTo.
    validateInResponseTo: ValidateInResponseTo.ifPresent,
    acceptedClockSkewMs: 60_000,
  };
  // Over https the request IDs live in a cookie, so any instance can check them (Vercel, several
  // containers). Plain-http localhost is one process, and keeps them in memory.
  const shared = new SAML(options);
  const samlFor = (req: FastifyRequest, reply: FastifyReply) =>
    secure ? new SAML({ ...options, cacheProvider: cookieRequestCache(req, reply, config.sessionSecret) }) : shared;

  app.addHook("onRequest", async (req, reply) => {
    const path = req.url.split("?")[0];
    if (!path.startsWith("/api/") || PUBLIC_PATHS.some((p) => path === p || (p.endsWith("/") && path.startsWith(p)))) return;
    const u = user(req);
    if (!u) return reply.code(401).send({ error: "Sign in required" });
    req.user = u;
  });

  // Entra posts the SAMLResponse and the sign-out form posts as application/x-www-form-urlencoded.
  await app.register(async (forms) => {
    await forms.register(formbody);

    forms.post("/api/auth/saml/acs", async (req, reply) => {
      const body = req.body as Record<string, string>;
      try {
        const { profile } = await samlFor(req, reply).validatePostResponseAsync(body);
        if (!profile) throw new Error("No profile in SAMLResponse");
        const u = userFromProfile(profile);
        reply.setCookie(COOKIE, sealSession(u, config.sessionSecret, config.sessionTtlMs), {
          ...cookieOpts,
          maxAge: config.sessionTtlMs / 1000,
        });
        req.log.info({ email: u.email }, "signed in");
        return reply.redirect(safeReturnTo(body.RelayState));
      } catch (err) {
        req.log.warn({ err }, "SAML sign-in rejected");
        return reply.redirect("/signed-out?error=signin");
      }
    });

    forms.post("/api/auth/logout", async (req, reply) => {
      const u = user(req);
      reply.clearCookie(COOKIE, cookieOpts);
      if (!u || !config.logoutUrl) return reply.redirect("/signed-out");
      const url = await shared.getLogoutUrlAsync(
        { issuer: config.issuer, nameID: u.nameID, nameIDFormat: u.nameIDFormat, sessionIndex: u.sessionIndex },
        "",
        {},
      );
      return reply.redirect(url);
    });

    // Entra's LogoutResponse (or a sign-out started elsewhere): the session is gone either way.
    const loggedOut = async (_req: FastifyRequest, reply: FastifyReply) => {
      reply.clearCookie(COOKIE, cookieOpts);
      return reply.redirect("/signed-out");
    };
    forms.get("/api/auth/saml/logout", loggedOut);
    forms.post("/api/auth/saml/logout", loggedOut);
  });

  app.get("/api/auth/login", async (req, reply) => {
    const returnTo = safeReturnTo((req.query as Record<string, unknown>).returnTo);
    return reply.redirect(await samlFor(req, reply).getAuthorizeUrlAsync(returnTo, undefined, {}));
  });

  app.get("/api/auth/saml/metadata", async (_req, reply) =>
    reply.type("application/xml").send(shared.generateServiceProviderMetadata(null)),
  );
}

/** What the browser gets: no SAML identifiers. */
const publicUser = ({ name, email }: SessionUser) => ({ name, email });
