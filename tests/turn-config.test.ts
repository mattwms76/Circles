import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  createLiveIceConfiguration,
  liveRelayNeedsRefresh,
  LIVE_RELAY_REFRESH_SKEW_MS,
} from "../lib/live-ice";
import {
  createTurnIceConfiguration,
  loadTurnConfiguration,
  TURN_CREDENTIAL_TTL_SECONDS,
  TurnConfigurationError,
} from "../server/turn-config";

const syntheticEnvironment = {
  NODE_ENV: "production",
  TURN_SERVER_URLS:
    "turn:relay.example.test:3478?transport=udp,turns:relay.example.test:5349?transport=tcp",
  TURN_SHARED_SECRET: "synthetic-test-only-turn-shared-secret",
} as const;

describe("coturn REST relay configuration", () => {
  it("fails production startup clearly when relay configuration is absent", () => {
    expect(() => loadTurnConfiguration({ NODE_ENV: "production" })).toThrow(
      /requires TURN_SERVER_URLS and TURN_SHARED_SECRET/,
    );
  });

  it("keeps an unconfigured development server on direct/STUN behavior", () => {
    expect(loadTurnConfiguration({ NODE_ENV: "development" })).toBeNull();
  });

  it("rejects partial, credential-bearing, malformed, or unsafe relay URLs", () => {
    expect(() =>
      loadTurnConfiguration({
        NODE_ENV: "development",
        TURN_SERVER_URLS: "turn:relay.example.test:3478",
      }),
    ).toThrow(TurnConfigurationError);
    expect(() =>
      loadTurnConfiguration({
        ...syntheticEnvironment,
        TURN_SERVER_URLS: "turn:user@relay.example.test:3478",
      }),
    ).toThrow(/Credentials, paths, fragments/);
    expect(() =>
      loadTurnConfiguration({
        ...syntheticEnvironment,
        TURN_SERVER_URLS: "https://relay.example.test:443",
      }),
    ).toThrow(/turn: or turns:/);
    expect(() =>
      loadTurnConfiguration({
        ...syntheticEnvironment,
        TURN_SERVER_URLS: "turn:relay.example.test:70000",
      }),
    ).toThrow(/between 1 and 65535/);
  });

  it("issues a user-bound, ten-minute coturn HMAC credential without returning the shared secret", () => {
    const configuration = loadTurnConfiguration(syntheticEnvironment);
    const now = Date.UTC(2026, 0, 1, 12, 0, 0);
    const relay = createTurnIceConfiguration(42, configuration, now);

    expect(relay).not.toBeNull();
    expect(relay?.iceServers).toHaveLength(1);
    expect(relay?.iceServers[0]?.username).toBe(
      `${Math.floor(now / 1000) + TURN_CREDENTIAL_TTL_SECONDS}:user-42`,
    );
    expect(relay?.iceServers[0]?.credential).toBe(
      createHmac("sha1", syntheticEnvironment.TURN_SHARED_SECRET)
        .update(relay?.iceServers[0]?.username ?? "")
        .digest("base64"),
    );
    expect(relay?.expiresAt).toBe(
      new Date(now + TURN_CREDENTIAL_TTL_SECONDS * 1000).toISOString(),
    );
    expect(JSON.stringify(relay)).not.toContain(
      syntheticEnvironment.TURN_SHARED_SECRET,
    );
  });

  it("does not issue relay data without a configured relay", () => {
    expect(
      createTurnIceConfiguration(42, null, Date.UTC(2026, 0, 1)),
    ).toBeNull();
  });

  it("turns an authenticated relay payload into peer ICE configuration", () => {
    const now = Date.now();
    const relay = createTurnIceConfiguration(
      42,
      loadTurnConfiguration(syntheticEnvironment),
      now,
    );
    expect(relay).not.toBeNull();
    if (!relay) throw new Error("Synthetic relay payload was not issued.");

    const relayIce = createLiveIceConfiguration(relay);
    expect(relayIce.iceServers[0]).toMatchObject({
      username: expect.stringContaining(":user-42"),
      credentialType: "password",
    });
    expect(relayIce.iceServers[0]?.urls).toEqual([
      "turn:relay.example.test:3478?transport=udp",
      "turns:relay.example.test:5349?transport=tcp",
    ]);
    expect(createLiveIceConfiguration(null).iceServers).toEqual([
      { urls: ["stun:stun.l.google.com:19302"] },
    ]);
  });

  it("rejects expired or implausibly future client relay timestamps and renews before expiry", () => {
    const now = Date.now();
    const relay = createTurnIceConfiguration(
      42,
      loadTurnConfiguration(syntheticEnvironment),
      now,
    );
    if (!relay) throw new Error("Synthetic relay payload was not issued.");

    expect(() =>
      createLiveIceConfiguration(
        { ...relay, expiresAt: new Date(now - 1).toISOString() },
        now,
      ),
    ).toThrow(/relay credentials are unavailable/);
    expect(() =>
      createLiveIceConfiguration(
        { ...relay, expiresAt: new Date(now + 62 * 60 * 1000).toISOString() },
        now,
      ),
    ).toThrow(/relay credentials are unavailable/);
    expect(
      liveRelayNeedsRefresh(
        relay,
        now + TURN_CREDENTIAL_TTL_SECONDS * 1000 - LIVE_RELAY_REFRESH_SKEW_MS,
      ),
    ).toBe(true);
  });

  it("keeps development STUN beside a loopback preview relay", () => {
    const now = Date.now();
    const relay = createTurnIceConfiguration(
      7,
      loadTurnConfiguration({
        NODE_ENV: "development",
        TURN_SERVER_URLS: "turn:127.0.0.1:3478",
        TURN_SHARED_SECRET: syntheticEnvironment.TURN_SHARED_SECRET,
      }),
      now,
    );
    expect(relay).not.toBeNull();
    if (!relay) throw new Error("Loopback relay payload was not issued.");
    const ice = createLiveIceConfiguration(relay, now);
    expect(ice.iceServers[0]?.urls).toEqual(["turn:127.0.0.1:3478"]);
    expect(ice.iceServers[1]).toEqual({
      urls: ["stun:stun.l.google.com:19302"],
    });
  });
});
