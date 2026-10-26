import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  batch1OperationIdentityMatches,
  batch1OperationScopeMatches,
  createBatch1OperationGuard,
  createBatch1OperationInstance,
} from "../lib/batch1-mutation-feedback";

function deferredTask<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function activateScope(accountId: number, resourceId: string, revision = 0) {
  const instance = createBatch1OperationInstance();
  const identity = instance.createIdentity(accountId, resourceId, revision);
  const scope = instance.activate(identity);
  if (!scope) throw new Error("Expected an authenticated operation scope");
  return { instance, identity, scope };
}

const appShell = readFileSync("components/app-shell.tsx", "utf8");
const profile = readFileSync("components/profile-screen.tsx", "utf8");
const create = readFileSync("app/create.tsx", "utf8");

describe("Batch 1 Follow/Join/Create mutation feedback", () => {
  it("blocks same-account, same-instance duplicate presses synchronously", async () => {
    const guard = createBatch1OperationGuard();
    const { scope } = activateScope(71, "profile:42");
    const pending = deferredTask();
    let calls = 0;

    const first = guard.run(scope, async () => {
      calls += 1;
      await pending.promise;
    });
    const duplicate = await guard.run(scope, async () => {
      calls += 1;
    });

    expect(guard.isActive(scope)).toBe(true);
    expect(guard.isActiveForAccount(71)).toBe(true);
    expect(guard.isActiveForAccount(72)).toBe(false);
    expect(duplicate).toEqual({ started: false });
    expect(calls).toBe(1);

    pending.resolve();
    await expect(first).resolves.toEqual({ started: true, value: undefined });
    expect(guard.isActive(scope)).toBe(false);
    expect(guard.isActiveForAccount(71)).toBe(false);
  });

  it("keeps different account/resource operation activations independently scoped", async () => {
    const guard = createBatch1OperationGuard();
    const { scope: profileScope } = activateScope(71, "profile:42");
    const { scope: circleScope } = activateScope(71, "circle:42");
    const { scope: otherAccountScope } = activateScope(72, "profile:42");

    await expect(
      Promise.all([
        guard.run(profileScope, async () => "follow"),
        guard.run(circleScope, async () => "join"),
        guard.run(otherAccountScope, async () => "other-account"),
      ]),
    ).resolves.toEqual([
      { started: true, value: "follow" },
      { started: true, value: "join" },
      { started: true, value: "other-account" },
    ]);
  });

  it("releases a failed operation for an explicit retry", async () => {
    const guard = createBatch1OperationGuard();
    const { scope } = activateScope(71, "composer:post:everyone");

    await expect(
      guard.run(scope, async () => {
        throw new Error("synthetic network failure");
      }),
    ).rejects.toThrow("synthetic network failure");
    await expect(guard.run(scope, async () => undefined)).resolves.toEqual({
      started: true,
      value: undefined,
    });
  });

  it("rejects an A→B→A completion from the earlier account/resource activation", () => {
    const instance = createBatch1OperationInstance();
    const firstAIdentity = instance.createIdentity(71, "circle:42", 0);
    const firstA = instance.activate(firstAIdentity);
    if (!firstA) throw new Error("Expected first A scope");

    instance.deactivate(firstA);
    const b = instance.activate(instance.createIdentity(72, "circle:42", 1));
    if (!b) throw new Error("Expected B scope");
    instance.deactivate(b);
    const secondAIdentity = instance.createIdentity(71, "circle:42", 2);
    const secondA = instance.activate(secondAIdentity);
    if (!secondA) throw new Error("Expected second A scope");

    expect(instance.isCurrent(firstA)).toBe(false);
    expect(instance.isCurrent(secondA)).toBe(true);
    expect(batch1OperationIdentityMatches(firstA, secondAIdentity)).toBe(false);
    expect(secondA.instanceId).toBeGreaterThan(firstA.instanceId);
  });

  it("rejects a completion from an unmounted remount even when account and resource repeat", () => {
    const firstMount = activateScope(71, "profile:42");
    firstMount.instance.deactivate(firstMount.scope);
    const remount = activateScope(71, "profile:42");

    expect(firstMount.instance.isCurrent(firstMount.scope)).toBe(false);
    expect(remount.instance.isCurrent(remount.scope)).toBe(true);
    expect(
      batch1OperationIdentityMatches(firstMount.scope, remount.identity),
    ).toBe(false);
  });

  it("rejects the first Strict Mode setup after cleanup and accepts the replay setup", () => {
    const instance = createBatch1OperationInstance();
    const identity = instance.createIdentity(71, "composer:post:everyone");
    const firstSetup = instance.activate(identity);
    if (!firstSetup) throw new Error("Expected first Strict Mode scope");
    instance.deactivate(firstSetup);
    const replaySetup = instance.activate(identity);
    if (!replaySetup) throw new Error("Expected replay Strict Mode scope");

    expect(instance.isCurrent(firstSetup)).toBe(false);
    expect(instance.isCurrent(replaySetup)).toBe(true);
    expect(replaySetup.instanceId).toBeGreaterThan(firstSetup.instanceId);
  });

  it("requires the exact captured activation as well as account and resource", () => {
    const { scope } = activateScope(71, "circle:42");

    expect(
      batch1OperationScopeMatches(scope, 71, "circle:42", scope.instanceId),
    ).toBe(true);
    expect(
      batch1OperationScopeMatches(scope, 72, "circle:42", scope.instanceId),
    ).toBe(false);
    expect(
      batch1OperationScopeMatches(scope, 71, "circle:43", scope.instanceId),
    ).toBe(false);
    expect(
      batch1OperationScopeMatches(scope, 71, "circle:42", scope.instanceId + 1),
    ).toBe(false);
  });

  it("uses keyed activation controls and a picker snapshot without render-time ref guards", () => {
    expect(appShell).toContain('from "../lib/batch1-mutation-feedback"');
    expect(appShell).toContain("createBatch1OperationInstance");
    expect(appShell).toContain("mountedRef.current = true");
    expect(appShell).toContain("operationInstance.isCurrent(scope)");
    expect(appShell).toContain(
      'key={`${accountId ?? "anonymous"}:${circle.id}`}',
    );
    expect(appShell).not.toContain("accountIdRef.current =");

    expect(profile).toContain("createBatch1OperationInstance");
    expect(profile).toContain("mountedRef.current = true");
    expect(profile).toContain("operationInstance.isCurrent(scope)");
    expect(profile).toContain(
      'key={`${accountId ?? "anonymous"}:${profileResourceId ?? "none"}`}',
    );
    expect(profile).toContain('accessibilityLabel="Go back from this profile"');
    expect(profile).not.toContain("accountIdRef.current =");

    expect(create).toContain("createBatch1OperationInstance");
    expect(create).toContain("mountedRef.current = true");
    expect(create).toContain("const pickerSnapshot = {");
    expect(create).toContain("mode,");
    expect(create).toContain("maxUploadMb,");
    expect(create).toContain(
      "if (!publishScopeIsCurrent(pickerSnapshot.scope)) return;",
    );
    expect(create).toContain('pickerSnapshot.mode === "circle"');
    expect(create).toContain("pickerSnapshot.maxUploadMb");
    expect(create).not.toContain("accountIdRef.current =");
    expect(create).not.toContain("publishGuard.isActiveForAccount(accountId)");
  });
});
