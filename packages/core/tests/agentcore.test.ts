import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentError, invokeAgent } from "@/lib/agentcore";

const COLD = { status: 424, body: '{"message":"Runtime initialization time exceeded. Please make sure that initialization completes in 30s."}' };

function mockFetch(replies: { status: number; body: string }[]) {
  const token = new Response(JSON.stringify({ access_token: "t", expires_in: 3600 }), { status: 200 });
  const queue = [token, ...replies.map((r) => new Response(r.body, { status: r.status }))];
  return vi.fn(async () => queue.shift()!);
}

describe("invokeAgent", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 1000 });
    Object.assign(process.env, {
      COGNITO_TOKEN_URL: "https://auth.example/oauth2/token",
      COGNITO_CLIENT_ID: "id",
      COGNITO_CLIENT_SECRET: "secret",
      AGENTCORE_RUNTIME_URL: "https://agent.example/invocations",
    });
    delete (globalThis as { __cognitoToken?: unknown }).__cognitoToken;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("retries once when the runtime cold start times out (424), then succeeds", async () => {
    const fetchMock = mockFetch([COLD, { status: 200, body: '{"ok":true}' }]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(invokeAgent({ action: "generate_report" })).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3); // token + 2 invocations
  });

  it("gives a clear message when the cold start fails twice", async () => {
    vi.stubGlobal("fetch", mockFetch([COLD, COLD]));
    const err = await invokeAgent({ action: "generate_report" }).catch((e) => e);
    expect(err).toBeInstanceOf(AgentError);
    expect((err as AgentError).userMessage).toMatch(/took too long to start/);
  });

  it("does not retry other errors", async () => {
    const fetchMock = mockFetch([{ status: 500, body: "boom" }]);
    vi.stubGlobal("fetch", fetchMock);
    await expect(invokeAgent({ action: "list_output_files" })).rejects.toBeInstanceOf(AgentError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
