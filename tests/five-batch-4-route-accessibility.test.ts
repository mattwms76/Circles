import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { contrastRatio, UI_ACCESSIBLE_COLORS } from "../lib/ui-accessibility";

const home = readFileSync("app/(tabs)/index.tsx", "utf8");
const liveLobby = readFileSync("app/live/index.tsx", "utf8");
const liveScreen = readFileSync("app/live/[id].tsx", "utf8");
const oauthCallback = readFileSync("app/oauth/callback.tsx", "utf8");
const postCard = readFileSync("components/post-card.tsx", "utf8");
const statusMessage = readFileSync("components/status-message.tsx", "utf8");

describe("Batch 4 route contrast, status, and media accessibility", () => {
  it("keeps changed normal status and action pairs at normal-text contrast", () => {
    for (const surface of ["#F9F8F5", "#FFFFFF", "#E9EEE5", "#FFF0EB"]) {
      expect(
        contrastRatio(UI_ACCESSIBLE_COLORS.secondary, surface),
      ).toBeGreaterThanOrEqual(4.5);
    }
    expect(
      contrastRatio(
        UI_ACCESSIBLE_COLORS.actionText,
        UI_ACCESSIBLE_COLORS.action,
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("makes the Home terminal disclosure accessible and clearly announces feed completion", () => {
    expect(home).toContain(
      "End of feed. Example community content. Your own story starts with sign-in.",
    );
    expect(home).toContain("<T style={{ color: C.secondary, fontSize: 11 }}>");
    expect(home).toContain("<T style={{ color: C.secondary, fontSize: 9 }}>");
    expect(home).not.toContain('color: "#A3A799"');
  });

  it("keeps Live list freshness while exposing truthful card labels and retry state", () => {
    expect(liveLobby).toContain(
      "trpc.live.list.useQuery({}, { refetchInterval: 5000 })",
    );
    expect(liveLobby).toContain(
      "const liveRetrying = lives.isFetching && !lives.isLoading;",
    );
    expect(liveLobby).toContain("loading={liveRetrying}");
    expect(liveLobby).toContain('accessibilityRole="button"');
    expect(liveLobby).toContain("accessibilityLabel={actionLabel}");
    expect(liveLobby).toContain("Continue camera setup");
    expect(liveLobby).toContain("Open live conversation:");
    expect(liveLobby).toContain(
      "backgroundColor: preparing ? C.secondary : C.action",
    );
    expect(liveLobby).toContain("color: C.actionText");
    expect(liveLobby).toContain("loading={platformStatus.isFetching}");
  });

  it("keeps Live session retries, bottom clearance, modal containment, and generation authority scoped", () => {
    expect(liveScreen).toContain("useSafeAreaInsets");
    expect(liveScreen).toContain(
      "const contentBottomInset = Math.max(32, insets.bottom + 16);",
    );
    expect(liveScreen).toContain("paddingBottom: contentBottomInset");
    expect(liveScreen).toContain("const endModalMaxHeight = Math.max(");
    expect(liveScreen).toContain("maxHeight: endModalMaxHeight");
    expect(liveScreen).toContain(
      'contentContainerStyle={{ flexGrow: 1, justifyContent: "center" }}',
    );
    expect(liveScreen).toContain(
      "trpc.live.list.useQuery({}, { refetchInterval: 4000 })",
    );
    expect(liveScreen).toContain("retrying={livesRetrying}");
    expect(liveScreen).toContain("retrying={chatRetrying}");
    expect(liveScreen).toContain(
      'const liveScope = `${user?.id ?? "guest"}:${streamId}`;',
    );
    expect(liveScreen).toContain(
      "if (!isCurrentLiveScope(operationScope)) return;",
    );
    expect(liveScreen).toContain("const generation = hostGeneration;");
    expect(liveScreen).toContain("{ streamId, generation },");
    expect(liveScreen).toContain("onPress={endLiveSession}");
    expect(liveScreen).toContain("const sendLiveReaction = useCallback");
    expect(liveScreen).toContain("onPress={sendLiveReaction}");
    expect(liveScreen).toContain(
      "!participantReady || isLiveChatSubmitting || !text.trim()",
    );
    expect(liveScreen).toContain(
      "editable={participantReady && !isLiveChatSubmitting}",
    );
    expect(liveScreen).not.toContain("onReady={");
  });

  it("keeps OAuth recovery scrollable with safe-area ownership while leaving exchange authority intact", () => {
    expect(oauthCallback).toContain(
      'edges={["top", "bottom", "left", "right"]}',
    );
    expect(oauthCallback).toContain("<ScrollView");
    expect(oauthCallback).toContain("flexGrow: 1");
    expect(oauthCallback).toContain("<StatusMessage");
    expect(statusMessage).toContain(
      'tone === "error" ? C.action : C.secondary',
    );
    expect(oauthCallback).toContain("color: C.action");
    expect(oauthCallback).toMatch(
      /await exchangeNativeOAuthCode\(\s*code,\s*state,\s*flow\.flowToken/,
    );
    expect(oauthCallback).toContain("await completeNativeLoginWithResult()");
    expect(oauthCallback).toContain(
      "OAuth.isNativeOAuthPendingFlowCurrent(flow)",
    );
    expect(oauthCallback).toContain(
      "OAuth.clearNativeOAuthPendingFlowIfCurrent(flow)",
    );
    expect(oauthCallback).not.toMatch(
      /^\s*await (?:OAuth\.)?clearNativeOAuthFlowToken\(/m,
    );
  });

  it("uses only truthful generic post-media descriptions and keeps controls scoped and operable", () => {
    expect(postCard).toContain(
      'const mediaAccessibilityLabel = `${post.mediaType === "video" ? "Video" : "Photo"} shared by ${post.author.name}`;',
    );
    expect(postCard).toContain('accessibilityRole="image"');
    expect(postCard).toContain("accessibilityLabel={mediaAccessibilityLabel}");
    expect(postCard).toContain("accessibilityState={{");
    expect(postCard).toContain("selected: liked,");
    expect(postCard).toContain("selected: commentsOpen,");
    expect(postCard).toContain("const actionBusy = !actionsAvailable;");
    expect(postCard).toContain("disabled: actionBusy,");
    expect(postCard).toContain("minWidth: 44");
    expect(postCard).toContain(
      "actionBusy || isCommentSubmitting || !commentText.trim()",
    );
    expect(postCard).toContain("loading={actionBusy || report.isPending}");
    expect(postCard).toContain("loading={actionBusy || remove.isPending}");
    expect(postCard).toContain(
      "isCurrentSource(operationScope, operationPost)",
    );
  });
});
