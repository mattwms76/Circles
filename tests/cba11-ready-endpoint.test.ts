import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Server } from "node:http";
import { createApiServer } from "../server/_core/index";

const mocks = vi.hoisted(() => ({ checkBackendReadiness: vi.fn() }));

vi.mock("../server/_core/readiness", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../server/_core/readiness")>();
  return { ...actual, checkBackendReadiness: mocks.checkBackendReadiness };
});

let server: Server;
let origin: string;

beforeAll(async () => {
  mocks.checkBackendReadiness.mockResolvedValue({
    ok: true,
    database: true,
    oauthState: true,
    liveRelay: false,
    mediaUploadBudget: false,
  });
  const instance = createApiServer();
  server = instance.server;
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("isolated CBA-11 listener unavailable");
  }
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
});

describe("CBA-11 /api/ready live deployment signal", () => {
  it("publishes sanitized relay and composite live-ready booleans without changing core availability", async () => {
    const response = await fetch(`${origin}/api/ready`);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      liveRelay: false,
      liveReady: false,
      mediaUploadBudget: false,
      mediaUploadReady: false,
    });
  });
});
