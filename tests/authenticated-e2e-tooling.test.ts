import { describe, expect, it } from "vitest";
import {
  MUTATION_ACKNOWLEDGEMENT,
  parseCliArguments as parseAuthenticatedCliArguments,
  runAuthenticatedE2E,
} from "../scripts/verify-authenticated-e2e.mjs";
import {
  runNativeReadiness,
  verifyNativeEvidence,
} from "../scripts/verify-native-readiness.mjs";

const syntheticFixture = {
  version: 1,
  accounts: {
    member: { bearerToken: "synthetic-member-token", userId: 101 },
    moderator: { bearerToken: "synthetic-moderator-token", userId: 102 },
    host: {
      bearerToken: "synthetic-host-token",
      userId: 103,
      nominatedForMutations: true,
    },
    viewer: {
      bearerToken: "synthetic-viewer-token",
      userId: 104,
      nominatedForMutations: true,
    },
    logout: {
      bearerToken: "synthetic-logout-token",
      userId: 105,
      nominatedForMutations: true,
      nominatedForLogout: true,
    },
  },
  ids: {
    privateCircleId: 201,
    privatePostId: 202,
    moderationPendingMemberId: 203,
    directConversationId: 204,
    attachmentPath:
      "/manus-storage/social-encrypted/101/123e4567-e89b-42d3-a456-426614174000.jpg.enc",
    streamId: 205,
    viewerGeneration: 1,
  },
  mutations: {
    runId: "synthetic-operator-run",
    nominatedAccounts: ["host", "viewer", "logout"],
    teardownStreamId: 205,
  },
};

function trpcResponse(value: unknown, status = 200) {
  return new Response(JSON.stringify({ result: { data: { json: value } } }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function authenticatedFetch(calls: { path: string; method: string }[]) {
  const tokens = new Map([
    ["synthetic-member-token", 101],
    ["synthetic-moderator-token", 102],
    ["synthetic-host-token", 103],
    ["synthetic-viewer-token", 104],
    ["synthetic-logout-token", 105],
  ]);
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const headers = new Headers(init?.headers);
    const token = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const userId = tokens.get(token);
    calls.push({ path: url.pathname, method: init?.method ?? "GET" });
    if (
      url.pathname ===
      "/api/media/social-encrypted/101/123e4567-e89b-42d3-a456-426614174000.jpg.enc"
    ) {
      return new Response(new Uint8Array([7]), {
        status: 206,
        headers: { "content-type": "image/jpeg" },
      });
    }
    if (!userId) {
      return new Response(
        JSON.stringify({ error: { data: { code: "UNAUTHORIZED" } } }),
        {
          status: 401,
        },
      );
    }
    const procedure = url.pathname.replace("/api/trpc/", "");
    if (procedure === "auth.me") return trpcResponse({ id: userId });
    if (procedure === "social.circle") {
      return trpcResponse({
        id: 201,
        privacy: "private",
        joined: true,
        role: userId === 102 ? "moderator" : "member",
      });
    }
    if (procedure === "social.members") {
      return trpcResponse(
        userId === 102
          ? [{ user: { id: 203 }, role: "pending" }]
          : [{ user: { id: 101 }, role: "member" }],
      );
    }
    if (procedure === "social.feed") return trpcResponse([{ id: 202 }]);
    if (procedure === "social.comments") return trpcResponse([]);
    if (procedure === "social.conversations")
      return trpcResponse([{ id: 204 }]);
    if (procedure === "social.messages") return trpcResponse([]);
    if (procedure === "live.signals" || procedure === "live.chat")
      return trpcResponse([]);
    return new Response(
      JSON.stringify({ error: { data: { code: "NOT_FOUND" } } }),
      {
        status: 404,
      },
    );
  };
}

function reconnectFetch(calls: { path: string; method: string }[]) {
  const readOnlyFetch = authenticatedFetch(calls);
  let viewerGeneration = 0;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    if (method === "POST" && url.pathname.startsWith("/api/trpc/live.")) {
      const headers = new Headers(init?.headers);
      calls.push({ path: url.pathname, method });
      if (headers.get("authorization") !== "Bearer synthetic-viewer-token") {
        return new Response(
          JSON.stringify({ error: { data: { code: "UNAUTHORIZED" } } }),
          {
            status: 401,
          },
        );
      }
      const procedure = url.pathname.replace("/api/trpc/", "");
      if (procedure === "live.join") {
        viewerGeneration += 1;
        return trpcResponse({
          hostId: 103,
          generation: viewerGeneration,
          hostGeneration: 1,
          signalCursor: 0,
        });
      }
      if (["live.heartbeat", "live.leave"].includes(procedure)) {
        return trpcResponse({ success: true });
      }
    }
    return readOnlyFetch(input, init);
  };
}

function reloadFetch(calls: { path: string; method: string }[]) {
  const readOnlyFetch = authenticatedFetch(calls);
  let viewerGeneration = 0;
  let hostGeneration = 1;
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input.toString());
    const method = init?.method ?? "GET";
    const headers = new Headers(init?.headers);
    const token = headers.get("authorization");
    const procedure = url.pathname.replace("/api/trpc/", "");
    if (method === "POST" && procedure === "live.join") {
      calls.push({ path: url.pathname, method });
      if (token === "Bearer synthetic-host-token") {
        hostGeneration += 1;
        return trpcResponse({
          hostId: 103,
          generation: hostGeneration,
          hostGeneration,
          signalCursor: 0,
        });
      }
      if (token === "Bearer synthetic-viewer-token") {
        viewerGeneration += 1;
        return trpcResponse({
          hostId: 103,
          generation: viewerGeneration,
          hostGeneration,
          signalCursor: 0,
        });
      }
    }
    if (method === "POST" && procedure === "live.leave") {
      calls.push({ path: url.pathname, method });
      return trpcResponse({ success: true });
    }
    if (
      method === "GET" &&
      procedure === "live.signals" &&
      hostGeneration === 2
    ) {
      const inputJson = url.searchParams.get("input");
      const generation = inputJson
        ? (JSON.parse(inputJson) as { json: { generation?: number } }).json
            .generation
        : undefined;
      if (generation === 1 && viewerGeneration === 1) {
        return trpcResponse([
          {
            kind: "join",
            fromId: 103,
            payload: JSON.stringify({
              type: "host-generation-restart",
              hostGeneration: 2,
            }),
          },
        ]);
      }
      if (generation === 1 && viewerGeneration === 2) {
        return new Response(
          JSON.stringify({ error: { data: { code: "FORBIDDEN" } } }),
          { status: 403 },
        );
      }
      if (generation === 2 && viewerGeneration === 2) return trpcResponse([]);
    }
    return readOnlyFetch(input, init);
  };
}

describe("authenticated native E2E operator tooling", () => {
  it("runs only authenticated reads by default and never emits fixture values", async () => {
    const calls: { path: string; method: string }[] = [];
    const report = await runAuthenticatedE2E({
      fixture: syntheticFixture,
      apiBaseUrl: "https://circles.test",
      fetchImpl: authenticatedFetch(calls),
    });

    expect(report.status).toBe("PASSED");
    expect(report.checks.map((item) => item.name)).toContain(
      "attachment.private_read",
    );
    expect(calls.every((call) => call.method === "GET")).toBe(true);
    expect(JSON.stringify(report)).not.toContain("synthetic-member-token");
    expect(JSON.stringify(report)).not.toContain(
      "123e4567-e89b-42d3-a456-426614174000",
    );
  });

  it("labels missing active-viewer context incomplete instead of passing it", async () => {
    const fixture = structuredClone(syntheticFixture);
    delete (fixture.ids as Partial<typeof fixture.ids>).viewerGeneration;
    const report = await runAuthenticatedE2E({
      fixture,
      apiBaseUrl: "https://circles.test",
      fetchImpl: authenticatedFetch([]),
    });

    expect(report.status).toBe("INCOMPLETE");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "fixture.viewer_generation",
        status: "INCOMPLETE",
      }),
    );
  });

  it("refuses a live mutation mode until the literal acknowledgement is supplied", async () => {
    expect(() =>
      parseAuthenticatedCliArguments([
        "--fixture-file",
        "/private/fixture.json",
        "--api-base-url",
        "https://circles.test",
        "--live-flow",
        "reconnect",
      ]),
    ).toThrow("mutations_require_allow_flag");

    const report = await runAuthenticatedE2E({
      fixture: syntheticFixture,
      apiBaseUrl: "https://circles.test",
      options: { liveFlow: "reconnect" },
      fetchImpl: authenticatedFetch([]),
    });
    expect(report.status).toBe("BLOCKED");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "live.mutation_guard",
        status: "BLOCKED",
      }),
    );
    expect(MUTATION_ACKNOWLEDGEMENT).toBe(
      "I_ACKNOWLEDGE_NOMINATED_TEST_SESSIONS_ONLY",
    );
  });

  it("uses only the nominated viewer session for an explicitly acknowledged reconnect", async () => {
    const calls: { path: string; method: string }[] = [];
    const report = await runAuthenticatedE2E({
      fixture: syntheticFixture,
      apiBaseUrl: "https://circles.test",
      options: {
        liveFlow: "reconnect",
        allowMutations: true,
        mutationAcknowledgement: MUTATION_ACKNOWLEDGEMENT,
      },
      fetchImpl: reconnectFetch(calls),
    });

    expect(report.status).toBe("PASSED");
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "live.reconnect", status: "PASSED" }),
    );
    expect(
      calls.filter((call) => call.method === "POST").map((call) => call.path),
    ).toEqual([
      "/api/trpc/live.join",
      "/api/trpc/live.heartbeat",
      "/api/trpc/live.leave",
      "/api/trpc/live.join",
      "/api/trpc/live.heartbeat",
      "/api/trpc/live.leave",
    ]);
  });

  it("requires the source-defined restart signal before rejoining a reloaded host", async () => {
    const calls: { path: string; method: string }[] = [];
    const report = await runAuthenticatedE2E({
      fixture: syntheticFixture,
      apiBaseUrl: "https://circles.test",
      options: {
        liveFlow: "reload",
        allowMutations: true,
        mutationAcknowledgement: MUTATION_ACKNOWLEDGEMENT,
      },
      fetchImpl: reloadFetch(calls),
    });

    expect(report.status).toBe("PASSED");
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: "live.reload", status: "PASSED" }),
    );
    expect(
      calls.filter((call) => call.method === "POST").map((call) => call.path),
    ).toEqual([
      "/api/trpc/live.join",
      "/api/trpc/live.join",
      "/api/trpc/live.join",
      "/api/trpc/live.leave",
    ]);
  });

  it("rejects browser, Expo Go, and bundle claims as native evidence", () => {
    // Device execution is not inferred from the source-only checks below.
    for (const surface of ["web", "expo-go", "bundle"]) {
      const result = verifyNativeEvidence({
        version: 1,
        execution: { surface, deviceKind: "physical" },
      });
      expect(result[0]).toMatchObject({
        name: "native.execution_surface",
        status: "BLOCKED",
        reason: "non_native_execution_surface_rejected",
      });
    }
  });

  it("blocks teardown without an observed nominated host generation", async () => {
    const calls: { path: string; method: string }[] = [];
    const report = await runAuthenticatedE2E({
      fixture: syntheticFixture,
      apiBaseUrl: "https://circles.test",
      options: {
        liveFlow: "teardown",
        allowMutations: true,
        mutationAcknowledgement: MUTATION_ACKNOWLEDGEMENT,
      },
      fetchImpl: authenticatedFetch(calls),
    });
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "live.teardown",
        status: "BLOCKED",
        reason:
          "host_stream_or_generation_not_explicitly_nominated_for_teardown",
      }),
    );
    expect(calls.filter((call) => call.method === "POST")).toEqual([]);
  });

  it("keeps source intent separate from synthetic device-evidence labels", () => {
    const report = runNativeReadiness({
      projectRoot: process.cwd(),
      evidence: {
        version: 1,
        execution: {
          surface: "development-build",
          platform: "android",
          deviceKind: "physical",
          buildId: "synthetic-build",
          deviceId: "synthetic-device",
          evidenceRef: "synthetic-test-record",
          executedAt: "2026-10-23T12:00:00.000Z",
        },
        checks: {
          nativeModule: "passed",
          login: "passed",
          deepLink: "passed",
          secureStore: "passed",
          privateReads: "passed",
          camera: "passed",
          microphone: "passed",
          hostViewer: "passed",
          teardown: "passed",
        },
      },
    });

    expect(report.status).toBe("PASSED");
    expect(report.checks).toContainEqual(
      expect.objectContaining({
        name: "source.native_webrtc_guard",
        status: "PASSED",
      }),
    );
  });
});
