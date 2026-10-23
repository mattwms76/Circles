import { describe, expect, it } from "vitest";
const { deriveEndpointInventory, PROJECT_ROOT, verifyReadOnlyEndpoints } =
  await import(new URL("../scripts/recover-api.mjs", import.meta.url).href);

const base = {
  circleId: 11,
  viewerId: null,
  welcomeMessage: "Welcome, everyone.",
  rules: ["Respect privacy."],
  pinnedPost: null,
  canManage: false,
  updatedAt: "2026-10-23T10:00:00Z",
};

async function verifyHome(payload: unknown) {
  const derived = deriveEndpointInventory(PROJECT_ROOT);
  const endpoints = derived.endpoints.filter(
    (endpoint: { name: string }) => endpoint.name === "circleHome.get",
  );
  expect(endpoints).toHaveLength(1);
  const calls: string[] = [];
  const result = await verifyReadOnlyEndpoints({
    apiBaseUrl: "http://127.0.0.1:3000",
    inventory: { ...derived, endpoints },
    auth: { bearerToken: null, ids: { circleId: 11 } },
    fetchImpl: async (_input: unknown, options?: RequestInit) => {
      calls.push(options?.method ?? "GET");
      return new Response(
        JSON.stringify({ result: { data: { json: payload } } }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
    },
  });
  expect(calls).toEqual(["GET"]);
  return result;
}

describe("Circle Home guarded recovery", () => {
  it("discovers only the source-derived read and accepts a bounded public response", async () => {
    const result = await verifyHome(base);
    expect(result.complete).toBe(true);
    expect(result.summary.failed).toBe(0);
    const inventory = deriveEndpointInventory(PROJECT_ROOT);
    expect(
      inventory.endpoints.some((endpoint: { name: string }) =>
        /circleHome\.(update|pin)/.test(endpoint.name),
      ),
    ).toBe(false);
  });

  it("uses Unicode code-point bounds for supplementary characters", async () => {
    const result = await verifyHome({
      ...base,
      welcomeMessage: "😀".repeat(2000),
      rules: ["😀".repeat(300)],
    });
    expect(result.complete).toBe(true);
  });

  it.each([
    ["missing content fields", { circleId: 11 }],
    ["oversized astral rule", { ...base, rules: ["😀".repeat(301)] }],
    [
      "oversized astral welcome",
      { ...base, welcomeMessage: "😀".repeat(2001) },
    ],
    ["multiline rule", { ...base, rules: ["one\ntwo"] }],
    ["duplicate rule", { ...base, rules: ["Be kind.", "be kind."] }],
    ["unnormalized rule", { ...base, rules: [" wrapped "] }],
    ["oversized welcome", { ...base, welcomeMessage: "x".repeat(2_001) }],
    [
      "too many rules",
      { ...base, rules: Array.from({ length: 11 }, () => "rule") },
    ],
    ["blank rule", { ...base, rules: ["   "] }],
    ["non-text rule", { ...base, rules: [42] }],
    ["oversized rule", { ...base, rules: ["x".repeat(301)] }],
    ["guest manager authority", { ...base, canManage: true }],
    ["extra fields", { ...base, unexpectedPrivateData: "synthetic" }],
    [
      "cross-circle pinned target",
      {
        ...base,
        pinnedPost: {
          id: 1,
          circleId: 22,
          text: "synthetic",
          author: { id: 1 },
        },
      },
    ],
    ["invalid timestamp", { ...base, updatedAt: "not-a-date" }],
  ])("rejects %s", async (_label, payload) => {
    const result = await verifyHome(payload);
    expect(result.complete).toBe(false);
    expect(result.checks).toEqual([
      {
        name: "circleHome.get",
        check: "positive",
        status: "failed",
        reason: "query_failed_or_shape_invalid",
      },
    ]);
  });
});
