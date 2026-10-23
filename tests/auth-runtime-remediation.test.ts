import { EventEmitter } from "node:events";
import type { AddressInfo } from "node:net";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BoundedOperationTimeoutError,
  requestCancellation,
  withOperationDeadline,
} from "../server/_core/bounded-network";
import { cleanupFailedNativeLoginConfirmation } from "../hooks/native-login-transition";
import { checkBackendReadiness } from "../server/_core/readiness";
import { createGracefulShutdown } from "../server/_core/index";

describe("auth/runtime remediation contracts", () => {
  afterEach(() => vi.restoreAllMocks());

  it("clears an unconfirmed captured bearer locally before attempting its exact remote revocation", async () => {
    const calls: string[] = [];
    const result = await cleanupFailedNativeLoginConfirmation({
      capturedBearer: "new-bearer-only",
      clearLocalCredentials: async () => {
        calls.push("local");
      },
      remoteLogout: async (bearer) => {
        calls.push(`remote:${bearer}`);
        throw new Error("synthetic remote failure");
      },
    });

    expect(calls).toEqual(["local", "remote:new-bearer-only"]);
    expect(result).toEqual({
      localCleanupFailed: false,
      remoteRevocationFailed: true,
    });
  });

  it("reports a failed local bearer cleanup without suppressing remote revocation", async () => {
    const remoteLogout = vi.fn(async () => undefined);
    const result = await cleanupFailedNativeLoginConfirmation({
      capturedBearer: "captured-bearer",
      clearLocalCredentials: async () => {
        throw new Error("synthetic secure-store failure");
      },
      remoteLogout,
    });

    expect(remoteLogout).toHaveBeenCalledWith("captured-bearer");
    expect(result).toEqual({
      localCleanupFailed: true,
      remoteRevocationFailed: false,
    });
  });

  it("returns a bounded readiness failure when a synthetic database query never settles", async () => {
    const never = new Promise<never>(() => undefined);
    const status = await checkBackendReadiness({
      databaseDeadlineMs: 1,
      getDatabase: async () =>
        ({
          $client: { query: () => never },
        }) as never,
    });

    expect(status).toMatchObject({
      ok: false,
      database: false,
      oauthState: false,
    });
  });

  it("bounds a never-settling helper operation and preserves caller cancellation", async () => {
    await expect(
      withOperationDeadline(new Promise<never>(() => undefined), 1),
    ).rejects.toBeInstanceOf(BoundedOperationTimeoutError);

    const controller = new AbortController();
    const operation = withOperationDeadline(
      new Promise<never>(() => undefined),
      1_000,
      controller.signal,
    );
    controller.abort();
    await expect(operation).rejects.toMatchObject({ name: "RequestAbortedError" });
  });

  it("aborts handler-owned downstream work on client disconnect, not normal response close", () => {
    const request = Object.assign(new EventEmitter(), { aborted: false });
    const response = Object.assign(new EventEmitter(), { writableEnded: true });
    const cancellation = requestCancellation(request as never, response as never);
    response.emit("close");
    expect(cancellation.signal.aborted).toBe(false);
    request.emit("aborted");
    expect(cancellation.signal.aborted).toBe(true);
    cancellation.dispose();
  });

  it("drains a synthetic listener and its pool exactly once when shutdown is called repeatedly", async () => {
    const app = express();
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    const poolClose = vi.fn(async () => undefined);
    const exit = vi.fn();
    const shutdown = createGracefulShutdown(server, {
      closePool: poolClose,
      exit,
      drainTimeoutMs: 50,
    });

    const first = shutdown();
    const second = shutdown();
    expect(second).toBe(first);
    await first;

    expect(poolClose).toHaveBeenCalledOnce();
    expect(exit).toHaveBeenCalledWith(0);
    expect((server.address() as AddressInfo | null)).toBeNull();
  });
});
