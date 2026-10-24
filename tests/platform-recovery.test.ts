import { describe, expect, it } from "vitest";
const { deriveEndpointInventory, PROJECT_ROOT, verifyReadOnlyEndpoints } =
  await import(new URL("../scripts/recover-api.mjs", import.meta.url).href);

async function verify(payload: unknown) {
  const derived = deriveEndpointInventory(PROJECT_ROOT);
  const endpoint = derived.endpoints.find(
    (item: { name: string }) => item.name === "platform.status",
  );
  expect(endpoint).toMatchObject({
    sourceAccess: "public",
    requiresAuth: false,
    supported: true,
  });
  const result = await verifyReadOnlyEndpoints({
    apiBaseUrl: "http://127.0.0.1:3000",
    inventory: { ...derived, endpoints: [endpoint] },
    fetchImpl: async (_url: string, options?: RequestInit) => {
      expect(options?.method).toBe("GET");
      expect(new Headers(options?.headers).has("Authorization")).toBe(false);
      return new Response(
        JSON.stringify({ result: { data: { json: payload } } }),
        { status: 200 },
      );
    },
  });
  return result.complete;
}
const settings = {
  registrationsOpen: true,
  circleCreationEnabled: true,
  liveStreamingEnabled: true,
  maintenanceMode: false,
  maxUploadMb: 5,
};
describe("minimal platform read-only verifier", () => {
  it("accepts explicit inactive and unavailable states without claiming active enforcement", async () => {
    expect(
      await verify({
        integration: "inactive",
        feature_readiness: false,
        settings: null,
      }),
    ).toBe(true);
    expect(
      await verify({
        integration: "active",
        feature_readiness: false,
        settings: null,
      }),
    ).toBe(true);
    expect(
      await verify({
        integration: "active",
        feature_readiness: true,
        settings,
      }),
    ).toBe(true);
  });
  it.each([
    { integration: "inactive", feature_readiness: true, settings },
    {
      integration: "active",
      feature_readiness: true,
      settings: { ...settings, maxUploadMb: 21 },
    },
    {
      integration: "active",
      feature_readiness: true,
      settings: { ...settings, reportThreshold: 10 },
    },
    {
      integration: "active",
      feature_readiness: true,
      settings: { ...settings, registrationsOpen: "true" },
    },
    {
      integration: "active",
      feature_readiness: false,
      settings: null,
      operators: [],
    },
  ])("rejects malformed or expanded responses %#", async (payload) => {
    expect(await verify(payload)).toBe(false);
  });
});
