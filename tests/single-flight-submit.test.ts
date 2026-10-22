import { describe, expect, it } from "vitest";
import { createSingleFlightSubmitter } from "../lib/single-flight-submit";

function deferredTask() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });

  return { promise, resolve };
}

describe("FND-002 composer submission guards", () => {
  it("runs an overlapping comment submit only once until the mutation settles", async () => {
    const submitter = createSingleFlightSubmitter();
    const pendingMutation = deferredTask();
    let mutationCalls = 0;

    const firstSubmit = submitter.run(async () => {
      mutationCalls += 1;
      await pendingMutation.promise;
    });
    const duplicateSubmit = await submitter.run(async () => {
      mutationCalls += 1;
    });

    expect(submitter.isBusy).toBe(true);
    expect(duplicateSubmit).toBe(false);
    expect(mutationCalls).toBe(1);

    pendingMutation.resolve();
    await expect(firstSubmit).resolves.toBe(true);
    expect(submitter.isBusy).toBe(false);
  });

  it("keeps the live-chat guard independent and releases it after a failed send", async () => {
    const commentSubmitter = createSingleFlightSubmitter();
    const liveChatSubmitter = createSingleFlightSubmitter();

    const commentSubmit = commentSubmitter.run(async () => undefined);
    const liveChatSubmit = liveChatSubmitter.run(async () => {
      throw new Error("synthetic send failure");
    });

    await expect(commentSubmit).resolves.toBe(true);
    await expect(liveChatSubmit).rejects.toThrow("synthetic send failure");
    expect(commentSubmitter.isBusy).toBe(false);
    expect(liveChatSubmitter.isBusy).toBe(false);

    await expect(liveChatSubmitter.run(async () => undefined)).resolves.toBe(
      true,
    );
  });
});
