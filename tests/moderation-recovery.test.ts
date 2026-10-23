import { describe, expect, it } from "vitest";
const { deriveEndpointInventory, PROJECT_ROOT, verifyReadOnlyEndpoints } =
  await import(new URL("../scripts/recover-api.mjs", import.meta.url).href);
const item = {
  id: 18,
  circleId: 11,
  postId: null,
  status: "open",
  reportCount: 1,
  createdAt: "2026-10-23T10:00:00Z",
  lastReportedAt: "2026-10-23T10:00:00Z",
  resolvedAt: null,
  canResolve: true,
  blockedReason: null,
};
const detail = {
  circleId: 11,
  viewerScope: 1,
  item,
  post: null,
  reasons: [{ reason: "Review requested", count: 1 }],
  history: [],
};
async function verify(
  name: string,
  payload: unknown,
  status: "open" | "resolved" = "open",
) {
  const derived = deriveEndpointInventory(PROJECT_ROOT);
  const endpoints = derived.endpoints.filter(
    (endpoint: { name: string }) =>
      endpoint.name === name || endpoint.name === "auth.me",
  );
  expect(endpoints).toHaveLength(2);
  const result = await verifyReadOnlyEndpoints({
    apiBaseUrl: "http://127.0.0.1:3000",
    inventory: { ...derived, endpoints },
    manifest: {
      "moderation.list": {
        input: { circleId: 11, viewerScope: 1, filter: status, limit: 20 },
      },
    },
    auth: {
      bearerToken: "synthetic-only",
      ids: { circleId: 11, viewerId: 1, moderationCaseId: 18 },
    },
    fetchImpl: async (input: string | URL, options?: RequestInit) => {
      const authenticated = new Headers(options?.headers).has("Authorization");
      if (String(input).includes("/auth.me"))
        return new Response(
          JSON.stringify({
            result: { data: { json: authenticated ? { id: 1 } : null } },
          }),
          { status: 200 },
        );
      if (!authenticated) return new Response("", { status: 401 });
      expect(options?.method).toBe("GET");
      return new Response(
        JSON.stringify({ result: { data: { json: payload } } }),
        { status: 200 },
      );
    },
  });
  return result.complete;
}
describe("moderator read-only recovery boundaries", () => {
  it("accepts an authorized unavailable target and bounded open queue", async () => {
    expect(await verify("moderation.detail", detail)).toBe(true);
    expect(
      await verify("moderation.list", {
        circleId: 11,
        viewerScope: 1,
        items: [item],
        nextCursor: null,
      }),
    ).toBe(true);
    const names = deriveEndpointInventory(PROJECT_ROOT).endpoints.map(
      (endpoint: { name: string }) => endpoint.name,
    );
    expect(names).not.toContain("moderation.resolve");
  });
  it("accepts resolved self-subject read-only detail and queue without authorizing self-review", async () => {
    const resolved = {
      ...item,
      status: "kept",
      resolvedAt: item.createdAt,
      canResolve: false,
      blockedReason: "self_review",
    };
    expect(
      await verify("moderation.detail", { ...detail, item: resolved }),
    ).toBe(true);
    expect(
      await verify(
        "moderation.list",
        {
          circleId: 11,
          viewerScope: 1,
          items: [resolved],
          nextCursor: null,
        },
        "resolved",
      ),
    ).toBe(true);
  });
  it.each([
    ["foreign circle", { ...detail, circleId: 12 }],
    ["foreign account", { ...detail, viewerScope: 2 }],
    ["foreign case", { ...detail, item: { ...item, id: 19 } }],
    ["reporter field", { ...detail, reporterIds: [5] }],
    [
      "reason reporter",
      {
        ...detail,
        reasons: [{ reason: "Review requested", count: 1, reporterId: 5 }],
      },
    ],
    [
      "foreign current post",
      {
        ...detail,
        item: { ...item, postId: 13 },
        post: { id: 13, circleId: 12, text: "synthetic", author: { id: 2 } },
      },
    ],
    [
      "oversized note",
      {
        ...detail,
        history: [
          {
            id: 1,
            decision: "keep",
            note: "x".repeat(501),
            reviewer: null,
            createdAt: item.createdAt,
          },
        ],
      },
    ],
    [
      "private reviewer field",
      {
        ...detail,
        history: [
          {
            id: 1,
            decision: "keep",
            note: "",
            reviewer: {
              id: 2,
              name: "Reviewer",
              email: "synthetic@example.invalid",
            },
            createdAt: item.createdAt,
          },
        ],
      },
    ],
    [
      "oversized reasons",
      {
        ...detail,
        reasons: Array.from({ length: 21 }, () => ({
          reason: "Review",
          count: 1,
        })),
      },
    ],
    [
      "invalid final state",
      { ...detail, item: { ...item, status: "removed" } },
    ],
  ])("rejects %s", async (_reason, payload) => {
    expect(await verify("moderation.detail", payload)).toBe(false);
  });
  it("rejects duplicate queue IDs and fabricated cursor", async () => {
    expect(
      await verify("moderation.list", {
        circleId: 11,
        viewerScope: 1,
        items: [item, item],
        nextCursor: null,
      }),
    ).toBe(false);
    expect(
      await verify("moderation.list", {
        circleId: 11,
        viewerScope: 1,
        items: [item],
        nextCursor: { id: 999 },
      }),
    ).toBe(false);
  });
});
