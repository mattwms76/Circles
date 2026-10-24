import { useLocalSearchParams, useRouter } from "expo-router";
import { ModerationWorkspace } from "@/components/moderation-workspace";
import { AppShell } from "@/components/app-shell";
import { Empty, Loading } from "@/components/circles-ui";
import { useCircles } from "@/hooks/circles-context";
import { parsePositiveSafeId } from "@/lib/feed-ui-helpers";
import { moderationScopeKey } from "@/lib/moderation-ui";

export default function ModerationReportsScreen() {
  const { circleId: rawCircleId } = useLocalSearchParams<{
    circleId?: string | string[];
  }>();
  const circleId = parsePositiveSafeId(rawCircleId);
  const router = useRouter();
  const { authState, showLogin, user } = useCircles();

  if (!circleId) {
    return (
      <AppShell>
        <Empty
          icon="shield-outline"
          title="This Reports link isn’t valid."
          text="Return to a circle to review its reports."
          action="Find circles"
          onAction={() => router.replace("/circles")}
        />
      </AppShell>
    );
  }

  if (!user && authState === "checking") {
    return (
      <AppShell>
        <Loading />
      </AppShell>
    );
  }

  if (!user) {
    return (
      <AppShell>
        <Empty
          icon="shield-outline"
          title="Reports are for circle managers."
          text="Sign in with an owner or moderator account to review this circle’s reports."
          action="Sign in"
          onAction={showLogin}
        />
      </AppShell>
    );
  }

  const scope = { circleId, viewerScope: user.id };
  return (
    <AppShell>
      <ModerationWorkspace
        key={moderationScopeKey(scope)}
        circleId={circleId}
        viewerId={user.id}
        onBack={() =>
          router.canGoBack()
            ? router.back()
            : router.replace(`/circle/${circleId}`)
        }
      />
    </AppShell>
  );
}
