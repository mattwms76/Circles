import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ImagePickerAsset } from "expo-image-picker";
import {
  a26MembershipIntent,
  a26MembershipNotice,
  canChangeA26IntroductionCircle,
  captureA26CircleChatOperation,
  captureA26IntroductionCircleId,
  createA26CircleChatSingleFlight,
  isCurrentA26CircleChatOperation,
  validateA26PickedComposerMedia,
} from "../lib/a26-circle-ui";

const mountedCircleA = { scope: "7:circle:41", generation: 4 };

function pickedAsset(
  overrides: Partial<ImagePickerAsset> = {},
): ImagePickerAsset {
  return {
    assetId: "asset-1",
    base64: null,
    duration: null,
    exif: null,
    fileName: "moment.jpg",
    fileSize: 1_024,
    height: 200,
    mimeType: "image/jpeg",
    type: "image",
    uri: "file:///moment.jpg",
    width: 200,
    ...overrides,
  } as ImagePickerAsset;
}

describe("A26-011 Circle Chat current-operation fence", () => {
  it("admits one activation and accepts completion only for the exact mounted account/circle generation", () => {
    const operation = captureA26CircleChatOperation({
      mountedOperation: mountedCircleA,
      currentScope: "7:circle:41",
      circleId: 41,
      circleName: "Morning Walks",
    });
    if (!operation) throw new Error("expected a valid chat operation");

    const flight = createA26CircleChatSingleFlight();
    expect(flight.start(operation)).toBe(true);
    expect(flight.start(operation)).toBe(false);
    expect(
      isCurrentA26CircleChatOperation({
        capturedOperation: operation,
        mountedOperation: mountedCircleA,
        currentScope: "7:circle:41",
      }),
    ).toBe(true);

    // This models a delayed old mutation completing after an actor/route change.
    expect(
      isCurrentA26CircleChatOperation({
        capturedOperation: operation,
        mountedOperation: { scope: "8:circle:42", generation: 1 },
        currentScope: "8:circle:42",
      }),
    ).toBe(false);
    expect(
      isCurrentA26CircleChatOperation({
        capturedOperation: operation,
        mountedOperation: { scope: "7:circle:41", generation: 5 },
        currentScope: "7:circle:41",
      }),
    ).toBe(false);

    flight.finish(operation);
    expect(flight.start(operation)).toBe(true);
  });

  it("refuses capture when the mounted account/circle scope is absent or no longer current", () => {
    expect(
      captureA26CircleChatOperation({
        mountedOperation: null,
        currentScope: "7:circle:41",
        circleId: 41,
        circleName: "Morning Walks",
      }),
    ).toBeNull();
    expect(
      captureA26CircleChatOperation({
        mountedOperation: mountedCircleA,
        currentScope: "8:circle:41",
        circleId: 41,
        circleName: "Morning Walks",
      }),
    ).toBeNull();
  });

  it("wires the Circle detail control through the synchronous flight, current completion check, and disabled state", () => {
    const source = readFileSync(
      new URL("../app/circle/[id].tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "const chatFlight = useRef(createA26CircleChatSingleFlight())",
    );
    expect(source).toContain("captureA26CircleChatOperation({");
    expect(source).toContain("isCurrentA26CircleChatOperation({");
    expect(source).toContain("onPress={openCircleChat}");
    expect(source).toContain("disabled={isChatPending}");
  });
});

describe("A26-027 pending-request cancellation wording", () => {
  it("uses a cancellation confirmation only for a pending membership exit", () => {
    expect(a26MembershipIntent(false, "pending")).toBe("cancel-request");
    expect(
      a26MembershipNotice({
        intent: "cancel-request",
        joined: false,
        role: null,
      }),
    ).toBe("Your membership request was cancelled.");
  });

  it("keeps approved exits and successful join outcomes truthful", () => {
    expect(a26MembershipIntent(false, "member")).toBe("leave");
    expect(
      a26MembershipNotice({ intent: "leave", joined: false, role: null }),
    ).toBe("You’ve left this circle.");
    expect(
      a26MembershipNotice({
        intent: "cancel-request",
        joined: true,
        role: "member",
      }),
    ).toBe("You’re in. Make yourself at home.");
  });

  it("wires the pending-request success path through its captured intent", () => {
    const source = readFileSync(
      new URL("../app/circle/[id].tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "const intent = a26MembershipIntent(joined, group?.role)",
    );
    expect(source).toContain("a26MembershipNotice({");
  });
});

describe("A26-016 first-post choice locking", () => {
  it("preserves the captured A destination when completion synchronously locks selection before B can be chosen", () => {
    let selectedCircleId = 41;
    const capturedDestination =
      captureA26IntroductionCircleId(selectedCircleId);

    const completionStarted = true;
    if (
      canChangeA26IntroductionCircle({
        controlsBusy: false,
        operationLocked: completionStarted,
      })
    ) {
      selectedCircleId = 42;
    }

    expect(selectedCircleId).toBe(41);
    expect(capturedDestination).toBe(41);
  });

  it("marks controls busy as non-interactive but permits a settled current selection change", () => {
    expect(
      canChangeA26IntroductionCircle({
        controlsBusy: true,
        operationLocked: false,
      }),
    ).toBe(false);
    expect(
      canChangeA26IntroductionCircle({
        controlsBusy: false,
        operationLocked: false,
      }),
    ).toBe(true);
    expect(captureA26IntroductionCircleId(0)).toBeNull();
    expect(captureA26IntroductionCircleId(42.5)).toBeNull();
  });

  it("wires disabled radio accessibility state, a synchronous handler guard, and a captured destination", () => {
    const source = readFileSync(
      new URL("../app/onboarding.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain(
      "const introductionDestination = captureA26IntroductionCircleId(",
    );
    expect(source).toContain("disabled: controlsBusy,");
    expect(source).toContain("disabled={controlsBusy}");
    expect(source).toContain("operationLocked: operationLock.current,");
    expect(source).toContain(
      "disabled={!introductionDestination || controlsBusy}",
    );
  });
});

describe("A26-028 picker validation outcomes", () => {
  it("returns actionable selected-file MIME and size errors without treating them as picker permission failures", () => {
    expect(
      validateA26PickedComposerMedia({
        asset: pickedAsset({ mimeType: "image/gif" }),
        mode: "post",
        maxUploadMb: 20,
      }),
    ).toEqual({
      kind: "invalid",
      message:
        "Choose a JPEG, PNG, WebP photo or MP4 video. Other formats aren’t supported yet.",
    });
    expect(
      validateA26PickedComposerMedia({
        asset: pickedAsset({ fileSize: 21 * 1024 * 1024 }),
        mode: "post",
        maxUploadMb: 20,
      }),
    ).toEqual({
      kind: "invalid",
      message: "Choose media no larger than 20 MiB.",
    });
  });

  it("retains existing 20 MiB media admission and cover-only photo policy after a successful picker result", () => {
    expect(
      validateA26PickedComposerMedia({
        asset: pickedAsset({ fileSize: 21 * 1024 * 1024 }),
        mode: "post",
        maxUploadMb: 25,
      }),
    ).toEqual({
      kind: "invalid",
      message: "Keep your photo or video under 20 MB.",
    });
    expect(
      validateA26PickedComposerMedia({
        asset: pickedAsset({ mimeType: "video/mp4", type: "video" }),
        mode: "circle",
        maxUploadMb: 20,
      }),
    ).toEqual({
      kind: "invalid",
      message: "Circle covers need a JPEG, PNG, or WebP photo.",
    });
  });

  it("accepts supported selected media and gives malformed success results an actionable retry message", () => {
    expect(
      validateA26PickedComposerMedia({
        asset: pickedAsset({ mimeType: "image/webp" }),
        mode: "post",
        maxUploadMb: 20,
      }),
    ).toEqual({ kind: "valid", mimeType: "image/webp" });
    expect(
      validateA26PickedComposerMedia({
        asset: undefined,
        mode: "post",
        maxUploadMb: 20,
      }),
    ).toEqual({
      kind: "invalid",
      message:
        "We couldn’t use that media selection. Choose a supported file and try again.",
    });
  });

  it("keeps picker launch failure separate from successful-result validation in the Create route", () => {
    const source = readFileSync(
      new URL("../app/create.tsx", import.meta.url),
      "utf8",
    );
    const pickerLaunch = source.indexOf(
      "result = await ImagePicker.launchImageLibraryAsync",
    );
    const launchError = source.indexOf(
      "Photo library could not open. Check your device permissions.",
    );
    const selectedValidation = source.indexOf(
      "validateA26PickedComposerMedia({",
    );

    expect(pickerLaunch).toBeGreaterThanOrEqual(0);
    expect(launchError).toBeGreaterThan(pickerLaunch);
    expect(selectedValidation).toBeGreaterThan(launchError);
  });
});
