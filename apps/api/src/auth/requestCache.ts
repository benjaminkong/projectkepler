// Where node-saml remembers the IDs of the sign-in requests it sent, so it can check that a
// SAMLResponse answers one of them (InResponseTo). Its default is process memory, which breaks as
// soon as the response reaches another instance (Vercel functions, more than one container).
// This keeps them in an encrypted cookie in the browser that started the sign-in instead.
//
// Entra posts the response cross-site, so the cookie must be SameSite=None, which browsers only
// accept with Secure: this is for https deployments. Plain-http localhost uses the memory store.
import type { CacheItem, CacheProvider } from "@node-saml/node-saml";
import type { FastifyReply, FastifyRequest } from "fastify";
import { seal, unseal } from "./session";

const COOKIE = "tsp_saml_req";
const TTL_MS = 10 * 60_000;
/** Several tabs can start a sign-in at once (say, when a session expires); keep the latest few. */
const MAX_PENDING = 5;

type Pending = { key: string; value: string; at: number };

export function cookieRequestCache(req: FastifyRequest, reply: FastifyReply, secret: string): CacheProvider {
  let pending = (unseal<Pending[]>(req.cookies[COOKIE], secret) ?? []).filter((p) => p.at + TTL_MS > Date.now());

  const write = () => {
    if (pending.length) {
      reply.setCookie(COOKIE, seal(pending, secret, TTL_MS), {
        path: "/api/auth/saml/acs",
        httpOnly: true,
        secure: true,
        sameSite: "none",
        maxAge: TTL_MS / 1000,
      });
    } else {
      reply.clearCookie(COOKIE, { path: "/api/auth/saml/acs", secure: true, sameSite: "none" });
    }
  };
  const remove = (key: string | null) => {
    const found = pending.find((p) => p.key === key);
    if (!found) return null;
    pending = pending.filter((p) => p !== found);
    write();
    return found.value;
  };

  return {
    async saveAsync(key, value): Promise<CacheItem | null> {
      if (pending.some((p) => p.key === key)) return null;
      const item = { key, value, at: Date.now() };
      pending = [...pending, item].slice(-MAX_PENDING);
      write();
      return { value, createdAt: item.at };
    },
    async getAsync(key) {
      return pending.find((p) => p.key === key)?.value ?? null;
    },
    async removeAsync(key) {
      return remove(key);
    },
    async consumeAsync(key) {
      return remove(key);
    },
  };
}
