import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  storageFetchSignedObject,
  StorageOperationError,
  StorageOperationTimeoutError,
} from "../server/storage";

const nodeHooks = vi.hoisted(() => {
  type RequestHook = (
    request: MockRequest,
    callback: (response: MockResponse) => void,
  ) => void;

  class MockRequest {
    destroyed = false;
    private readonly listeners = new Map<string, ((error: Error) => void)[]>();
    readonly write = vi.fn();
    readonly end = vi.fn(() => {
      nodeHooks.requestHook?.(this, nodeHooks.responseCallback!);
    });
    readonly destroy = vi.fn((error?: Error) => {
      if (this.destroyed) return this;
      this.destroyed = true;
      if (error) this.emit("error", error);
      return this;
    });

    once(event: string, listener: (error: Error) => void) {
      this.listeners.set(event, [
        ...(this.listeners.get(event) ?? []),
        listener,
      ]);
      return this;
    }

    emit(event: string, error: Error) {
      const listeners = this.listeners.get(event) ?? [];
      this.listeners.delete(event);
      for (const listener of listeners) listener(error);
      return listeners.length > 0;
    }
  }

  class MockAgent {
    destroyed = false;
    readonly destroy = vi.fn(() => {
      this.destroyed = true;
    });

    constructor(readonly options: Record<string, unknown>) {
      nodeHooks.agents.push(this);
    }
  }

  return {
    lookup: vi.fn(),
    httpsRequest: vi.fn(),
    MockRequest,
    MockAgent,
    agents: [] as MockAgent[],
    requestHook: undefined as RequestHook | undefined,
    responseCallback: undefined as
      | ((response: MockResponse) => void)
      | undefined,
  };
});

vi.mock("node:dns/promises", () => ({ lookup: nodeHooks.lookup }));
vi.mock("node:https", () => ({
  Agent: nodeHooks.MockAgent,
  request: nodeHooks.httpsRequest,
}));

type MockResponse = PassThrough & {
  statusCode?: number;
  headers: Record<string, string | string[] | undefined>;
};

function response(statusCode = 200): MockResponse {
  return Object.assign(new PassThrough(), {
    statusCode,
    headers: { "content-type": "application/octet-stream" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function trackedSignal() {
  const controller = new AbortController();
  return {
    controller,
    add: vi.spyOn(controller.signal, "addEventListener"),
    remove: vi.spyOn(controller.signal, "removeEventListener"),
  };
}

function configureHttps(
  hook: (
    request: InstanceType<typeof nodeHooks.MockRequest>,
    callback: (response: MockResponse) => void,
  ) => void,
) {
  nodeHooks.requestHook = hook;
  nodeHooks.httpsRequest.mockImplementation(
    (
      _url: URL,
      _options: Record<string, unknown>,
      callback: (incoming: MockResponse) => void,
    ) => {
      nodeHooks.responseCallback = callback;
      return new nodeHooks.MockRequest();
    },
  );
}

beforeEach(() => {
  vi.stubEnv(
    "CIRCLES_STORAGE_OBJECT_ORIGINS",
    "https://objects.synthetic.test",
  );
  nodeHooks.lookup.mockResolvedValue([{ address: "8.8.8.8", family: 4 }]);
  nodeHooks.httpsRequest.mockReset();
  nodeHooks.agents.splice(0);
  nodeHooks.requestHook = undefined;
  nodeHooks.responseCallback = undefined;
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("SEC-027 pinned storage transfer lifecycle", () => {
  it("bounds slow DNS, propagates caller cancellation, and leaves its uncancellable lookup observed", async () => {
    const lookup = deferred<{ address: string; family: number }[]>();
    nodeHooks.lookup.mockReturnValue(lookup.promise);
    const signal = trackedSignal();
    const callerAbort = new Error("caller disconnected during DNS");

    const transfer = storageFetchSignedObject(
      "https://objects.synthetic.test/object",
      { signal: signal.controller.signal },
    );
    signal.controller.abort(callerAbort);

    await expect(transfer).rejects.toBe(callerAbort);
    expect(nodeHooks.httpsRequest).not.toHaveBeenCalled();
    expect(signal.remove).toHaveBeenCalled();

    // dns/promises has no cancellation API. Completing after the caller leaves must remain safe.
    lookup.resolve([{ address: "8.8.8.8", family: 4 }]);
    await Promise.resolve();
  });

  it("times out an unresolved DNS wait before HTTPS starts and observes a late resolver rejection", async () => {
    vi.useFakeTimers();
    const lookup = deferred<{ address: string; family: number }[]>();
    nodeHooks.lookup.mockReturnValue(lookup.promise);

    const transfer = storageFetchSignedObject(
      "https://objects.synthetic.test/object",
    );
    const timeoutResult = expect(transfer).rejects.toBeInstanceOf(
      StorageOperationTimeoutError,
    );
    await vi.advanceTimersByTimeAsync(15_000);

    await timeoutResult;
    expect(nodeHooks.httpsRequest).not.toHaveBeenCalled();
    lookup.reject(new Error("late DNS failure"));
    await Promise.resolve();
  });

  it("pins DNS into a verified direct HTTPS request with the deployment hostname as TLS SNI", async () => {
    const incoming = response();
    configureHttps((_request, callback) => callback(incoming));

    const transfer = storageFetchSignedObject(
      "https://objects.synthetic.test/object?signature=opaque",
    );
    const received = await transfer;
    const request = nodeHooks.httpsRequest.mock.results[0]
      ?.value as InstanceType<typeof nodeHooks.MockRequest>;
    const [, options] = nodeHooks.httpsRequest.mock.calls[0] as [
      URL,
      Record<string, unknown>,
    ];

    expect(nodeHooks.lookup).toHaveBeenCalledWith("objects.synthetic.test", {
      all: true,
      verbatim: true,
    });
    expect(options).toMatchObject({
      method: "GET",
      family: 4,
      servername: "objects.synthetic.test",
      rejectUnauthorized: true,
      headers: { "Accept-Encoding": "identity" },
    });
    const agent = nodeHooks.agents[0];
    expect(agent?.options).toMatchObject({ keepAlive: false, maxSockets: 1 });
    const pinnedLookup = agent?.options.lookup as (
      hostname: string,
      options: unknown,
      callback: (error: Error | null, address: string, family: number) => void,
    ) => void;
    const lookupResult = deferred<[Error | null, string, number]>();
    pinnedLookup("objects.synthetic.test", {}, (error, address, family) =>
      lookupResult.resolve([error, address, family]),
    );
    await expect(lookupResult.promise).resolves.toEqual([null, "8.8.8.8", 4]);

    incoming.end(Buffer.from("ok"));
    await expect(received.text()).resolves.toBe("ok");
    expect(request.destroy).not.toHaveBeenCalled();
    expect(agent?.destroy).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline and caller signal after headers, then destroys a stalled response, request, and agent", async () => {
    vi.useFakeTimers();
    const incoming = response();
    let request: InstanceType<typeof nodeHooks.MockRequest> | undefined;
    configureHttps((created, callback) => {
      request = created;
      callback(incoming);
    });
    const signal = trackedSignal();

    const transfer = await storageFetchSignedObject(
      "https://objects.synthetic.test/stalled",
      { signal: signal.controller.signal },
    );
    // DNS installs its own temporary deadline listener. The transfer listener remains until the
    // body settles, which is why exactly one removal has happened at header arrival.
    expect(signal.remove).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(15_000);

    expect(incoming.destroyed).toBe(true);
    expect(request?.destroy).toHaveBeenCalledTimes(1);
    expect(nodeHooks.agents[0]?.destroy).toHaveBeenCalledTimes(1);
    expect(signal.remove).toHaveBeenCalledTimes(2);
    await expect(transfer.body?.getReader().read()).rejects.toBeInstanceOf(
      Error,
    );
  });

  it("releases the timer and caller listener after normal body completion or explicit body cancellation", async () => {
    vi.useFakeTimers();
    const normal = response();
    let normalRequest: InstanceType<typeof nodeHooks.MockRequest> | undefined;
    configureHttps((created, callback) => {
      normalRequest = created;
      callback(normal);
    });
    const normalSignal = trackedSignal();

    const normalTransfer = await storageFetchSignedObject(
      "https://objects.synthetic.test/normal",
      { signal: normalSignal.controller.signal },
    );
    normal.end(Buffer.from("done"));
    await expect(normalTransfer.text()).resolves.toBe("done");
    normalSignal.controller.abort(new Error("late abort"));
    await vi.advanceTimersByTimeAsync(15_000);
    expect(normalRequest?.destroy).not.toHaveBeenCalled();
    expect(normalSignal.remove).toHaveBeenCalledTimes(2);

    const cancelled = response();
    let cancelledRequest:
      | InstanceType<typeof nodeHooks.MockRequest>
      | undefined;
    configureHttps((created, callback) => {
      cancelledRequest = created;
      callback(cancelled);
    });
    const cancelSignal = trackedSignal();
    const cancelledTransfer = await storageFetchSignedObject(
      "https://objects.synthetic.test/cancelled",
      { signal: cancelSignal.controller.signal },
    );
    await cancelledTransfer.body?.cancel("consumer no longer needs bytes");
    cancelSignal.controller.abort(new Error("late abort"));
    await vi.advanceTimersByTimeAsync(15_000);

    expect(cancelled.destroyed).toBe(true);
    expect(cancelledRequest?.destroy).toHaveBeenCalledTimes(1);
    expect(cancelSignal.remove).toHaveBeenCalledTimes(2);
  });

  it.each([
    [302, "Storage transfer was redirected"],
    [undefined, "Storage transfer returned an invalid response"],
    [600, "Storage transfer returned an invalid response"],
  ] as const)(
    "rejects status %s before exposing a body and disposes every transport resource",
    async (statusCode, message) => {
      const incoming = response();
      incoming.statusCode = statusCode;
      let request: InstanceType<typeof nodeHooks.MockRequest> | undefined;
      configureHttps((created, callback) => {
        request = created;
        callback(incoming);
      });

      await expect(
        storageFetchSignedObject("https://objects.synthetic.test/object"),
      ).rejects.toMatchObject({
        name: StorageOperationError.name,
        message,
      });
      expect(incoming.destroyed).toBe(true);
      expect(request?.destroy).toHaveBeenCalledTimes(1);
      expect(nodeHooks.agents[0]?.destroy).toHaveBeenCalledTimes(1);
    },
  );
});
