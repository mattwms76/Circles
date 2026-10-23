import { describe, expect, it } from "vitest";
const { deriveEndpointInventory, PROJECT_ROOT, verifyReadOnlyEndpoints } =
  await import(new URL("../scripts/recover-api.mjs", import.meta.url).href);

async function verifyActivity(name: string, payload: unknown) {
  const derived = deriveEndpointInventory(PROJECT_ROOT);
  const endpoints = derived.endpoints.filter(
    (endpoint: { name: string }) =>
      endpoint.name === name || endpoint.name === "auth.me",
  );
  expect(endpoints).toHaveLength(2);
  const result = await verifyReadOnlyEndpoints({
    apiBaseUrl: "http://127.0.0.1:3000",
    inventory: { ...derived, endpoints },
    auth: { bearerToken: "synthetic-only", ids: { activityId: 17 } },
    fetchImpl: async (input: string | URL, options?: RequestInit) => {
      if (String(input).includes("/auth.me")) {
        const user = new Headers(options?.headers).has("Authorization")
          ? { id: 1 }
          : null;
        return new Response(
          JSON.stringify({ result: { data: { json: user } } }),
          { status: 200 },
        );
      }
      if (!new Headers(options?.headers).has("Authorization"))
        return new Response("", { status: 401 });
      expect(options?.method).toBe("GET");
      return new Response(
        JSON.stringify({ result: { data: { json: payload } } }),
        { status: 200 },
      );
    },
  });
  return result.complete;
}
const unavailable = {
  id: 17,
  kind: "comment_on_your_post",
  createdAt: "2026-10-23T10:00:00Z",
  readAt: null,
  available: false,
  actorName: null,
  circleName: null,
};
const page = { viewerId: 1, items: [unavailable], nextCursor: null };

describe("Activity Inbox guarded recovery", () => {
  it("discovers only read queries and verifies an intentionally unavailable item", async () => {
    expect(await verifyActivity("activity.list", page)).toBe(true);
    const names = deriveEndpointInventory(PROJECT_ROOT).endpoints.map(
      (item: { name: string }) => item.name,
    );
    expect(
      names.filter((name: string) => name.startsWith("activity.")),
    ).toEqual(
      expect.arrayContaining([
        "activity.list",
        "activity.unreadCount",
        "activity.preferences",
        "activity.resolveTarget",
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining([
        "activity.markRead",
        "activity.markAllRead",
        "activity.updateCategories",
        "activity.setCircleMuted",
      ]),
    );
  });
  it.each([
    [
      "actor leakage",
      { ...page, items: [{ ...unavailable, actorName: "Private actor" }] },
    ],
    [
      "circle leakage",
      { ...page, items: [{ ...unavailable, circleName: "Private circle" }] },
    ],
    ["duplicate IDs", { ...page, items: [unavailable, unavailable] }],
    [
      "unbounded item metadata",
      {
        ...page,
        items: [{ ...unavailable, unexpectedBody: "must not be included" }],
      },
    ],
    ["arbitrary cursor", { ...page, nextCursor: { beforeId: 99 } }],
    ["missing viewer", { ...page, viewerId: null }],
    [
      "oversized page",
      {
        ...page,
        items: Array.from({ length: 41 }, (_, index) => ({
          ...unavailable,
          id: 100 - index,
        })),
      },
    ],
  ])("rejects %s", async (_label, payload) => {
    expect(await verifyActivity("activity.list", payload)).toBe(false);
  });
  it("validates read watermark and category switches", async () => {
    expect(
      await verifyActivity("activity.unreadCount", {
        viewerId: 1,
        count: 0,
        throughId: 17,
      }),
    ).toBe(true);
    expect(
      await verifyActivity("activity.unreadCount", {
        viewerId: 1,
        count: 1,
        throughId: 0,
      }),
    ).toBe(false);
    expect(
      await verifyActivity("activity.preferences", {
        viewerId: 1,
        commentsEnabled: true,
        membershipApprovalsEnabled: false,
        circle: null,
      }),
    ).toBe(true);
    expect(
      await verifyActivity("activity.preferences", {
        viewerId: 1,
        commentsEnabled: "true",
        membershipApprovalsEnabled: true,
        circle: null,
      }),
    ).toBe(false);
  });
  it("accepts unavailable targets but rejects URL-shaped or unscoped destinations", async () => {
    expect(
      await verifyActivity("activity.resolveTarget", {
        viewerId: 1,
        activityId: 17,
        target: null,
      }),
    ).toBe(true);
    expect(
      await verifyActivity("activity.resolveTarget", {
        viewerId: 1,
        activityId: 17,
        target: { type: "circle", circleId: 11 },
      }),
    ).toBe(true);
    expect(
      await verifyActivity("activity.resolveTarget", {
        viewerId: 1,
        activityId: 17,
        target: { type: "url", url: "https://outside.example" },
      }),
    ).toBe(false);
  });
});
