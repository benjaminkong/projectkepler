import type { FastifyReply } from "fastify";
import { getTenderSite, type TenderSite } from "@tender/core/ura";

export type Query = Record<string, string | string[] | undefined>;

/** Every value of a repeated query key, trimmed, without blanks or duplicates. */
export const queryAll = (q: Query, key: string): string[] => {
  const v = q[key];
  return [...new Set((Array.isArray(v) ? v : v ? [v] : []).map((x) => x.trim()).filter(Boolean))];
};
export const queryOne = (q: Query, key: string): string | undefined => queryAll(q, key)[0];

/** The site for `slug`, or sends a 404 and returns null. */
export async function siteOr404(slug: string, reply: FastifyReply, body: object = { error: "Site not found" }): Promise<TenderSite | null> {
  const site = await getTenderSite(slug);
  if (!site) reply.code(404).send(body);
  return site;
}
