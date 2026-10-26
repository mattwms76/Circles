import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createMessageCompositionSingleFlight,
  isCurrentMessageCompositionOperation,
  type MessageCompositionOperation,
} from "../lib/batch2-message-accessibility";
import {
  createBatch3AccountResourceSingleFlight,
  isCurrentBatch3AccountResourceOperation,
  type Batch3AccountResourceOperation,
} from "../lib/batch3-account-resource-scope";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((complete, fail) => {
    resolve = complete;
    reject = fail;
  });
  return { promise, reject, resolve };
}

const chat = readFileSync("app/chat/[id].tsx", "utf8");
const discover = readFileSync("app/(tabs)/discover.tsx", "utf8");
const circle = readFileSync("app/circle/[id].tsx", "utf8");
const circleCard = readFileSync("components/circle-card.tsx", "utf8");

describe("Batch 2/3 operation lifecycle integrity", () => {
  it("rejects A → B → A completions for Discover and Circle generations", () => {
    const discoverBeforeSwitch: Batch3AccountResourceOperation = {
      scope: "17:discover",
      generation: 4,
    };
    const discoverAfterSwitchBack: Batch3AccountResourceOperation = {
      scope: "17:discover",
      generation: 6,
    };
    const circleBeforeSwitch: Batch3AccountResourceOperation = {
      scope: "17:circle:91",
      generation: 8,
    };
    const circleAfterSwitchBack: Batch3AccountResourceOperation = {
      scope: "17:circle:91",
      generation: 10,
    };

    expect(
      isCurrentBatch3AccountResourceOperation(
        discoverAfterSwitchBack,
        discoverBeforeSwitch,
      ),
    ).toBe(false);
    expect(
      isCurrentBatch3AccountResourceOperation(
        circleAfterSwitchBack,
        circleBeforeSwitch,
      ),
    ).toBe(false);
  });

  it("admits only one same-target Batch 3 operation and cannot let an old finish release a new generation", () => {
    const flight = createBatch3AccountResourceSingleFlight();
    const first: Batch3AccountResourceOperation = {
      scope: "17:circle:91",
      generation: 2,
    };
    const afterStrictModeReplay: Batch3AccountResourceOperation = {
      scope: "17:circle:91",
      generation: 3,
    };

    expect(flight.start(first)).toBe(true);
    expect(flight.start(first)).toBe(false);
    flight.finish(first);
    expect(flight.start(afterStrictModeReplay)).toBe(true);
    flight.finish(first);
    expect(flight.start(afterStrictModeReplay)).toBe(false);
    flight.finish(afterStrictModeReplay);
    expect(flight.start(afterStrictModeReplay)).toBe(true);
  });

  it("runs one Chat upload/send for back-to-back submits and retains one retry payload after a delayed send failure", async () => {
    const flight = createMessageCompositionSingleFlight();
    const operation: MessageCompositionOperation = {
      scope: "17:conversation:33",
      generation: 5,
    };
    const delayedSend = deferred<void>();
    let uploadCalls = 0;
    let sendCalls = 0;
    let clientMessageId: string | null = null;
    let uploadedMediaUrl: string | null = null;
    let deliveryUncertain: MessageCompositionOperation | null = null;

    const submit = async () => {
      if (!flight.start(operation)) return false;
      try {
        clientMessageId ??= "retry-uuid-33";
        uploadedMediaUrl ??= `https://media.test/${++uploadCalls}`;
        sendCalls += 1;
        await delayedSend.promise;
        clientMessageId = null;
        uploadedMediaUrl = null;
        return true;
      } catch {
        deliveryUncertain = operation;
        return false;
      } finally {
        flight.finish(operation);
      }
    };

    const first = submit();
    const duplicate = await submit();
    expect(duplicate).toBe(false);
    expect(uploadCalls).toBe(1);
    expect(sendCalls).toBe(1);

    delayedSend.reject(new Error("delayed transport failure"));
    await expect(first).resolves.toBe(false);
    expect(clientMessageId).toBe("retry-uuid-33");
    expect(uploadedMediaUrl).toBe("https://media.test/1");
    expect(
      isCurrentMessageCompositionOperation(deliveryUncertain, operation),
    ).toBe(true);
  });

  it("keeps effect-owned operation identity, synchronous ref guards, and reachable older-page retry in the owned screens", () => {
    expect(chat).toContain(
      "<ChatScreenInstance key={compositionKey} conversationId={conversationId} />",
    );
    expect(chat).toContain("sendFlight.current.start(operation)");
    expect(chat).toContain("sendWasAttempted");
    expect(chat).toContain("uploadedMediaUrl.current = media");
    expect(chat).toContain("conversationUnavailable");
    expect(chat).toContain("!hasOlderPageError");
    expect(chat).toContain("color: C.action");
    expect(chat).toContain("color: C.secondary");

    expect(discover).toContain(
      '<DiscoverScreenInstance key={discoverScope ?? "guest:discover"} />',
    );
    expect(discover).toContain("followFlight.current.start(capturedScope)");
    expect(discover).toContain("new Set<number>(");
    expect(circle).toContain("membershipFlight.current.start(capturedScope)");
    expect(circle).toContain("<CircleScreenInstance");
    expect(circleCard).toContain("joinFlight.current.start(capturedScope)");
    expect(circleCard).toContain("<CircleCardInstance");
  });
});
