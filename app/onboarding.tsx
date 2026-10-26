import React, { useEffect, useRef, useState } from "react";
import { Pressable, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { AppShell } from "@/components/app-shell";
import { Button, C, Empty, Icon, Loading, s, T } from "@/components/circles-ui";
import { StatusMessage } from "@/components/status-message";
import { useCircles } from "@/hooks/circles-context";
import {
  isCurrentOnboardingAccount,
  isIntroductionEligible,
  hydrateOnboardingForAccount,
  toggleInterestSelection,
} from "@/lib/onboarding-ui";
import {
  canChangeA26IntroductionCircle,
  captureA26IntroductionCircleId,
} from "../lib/a26-circle-ui";
import { trpc } from "@/lib/trpc";
import {
  INTERESTS,
  MAX_INTERESTS,
  type InterestId,
  type OnboardingStatus,
} from "@/shared/onboarding";
import type { Circle } from "@/shared/social";

type WizardScreen = "interests" | "circles" | "first-post";
type FinishDestination = "circles" | "intro";
type OnboardingStatusTone = "info" | "success" | "error";
type OnboardingOutcome = {
  message: string;
  tone: OnboardingStatusTone;
};

function isEditMode(value: string | string[] | undefined): boolean {
  return Array.isArray(value) ? value.includes("1") : value === "1";
}

function initialWizardScreen(
  status: OnboardingStatus,
  editMode: boolean,
): WizardScreen {
  if (editMode || status.step === "complete") return "interests";
  return status.step;
}

function OptionalGuestScreen() {
  const router = useRouter();
  const { showLogin } = useCircles();
  return (
    <AppShell sidebar={false}>
      <View style={{ gap: 18, paddingTop: 18 }}>
        <T style={s.eyebrow}>OPTIONAL SETUP</T>
        <T style={s.title}>A few preferences, only if you want them.</T>
        <T style={{ color: C.secondary, lineHeight: 22 }}>
          Sign in to choose up to six interests and get optional public-circle
          suggestions. Your interests are private to your account.
        </T>
        <Button title="Sign in to personalise" onPress={showLogin} />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip onboarding and explore circles"
          onPress={() => router.replace("/circles")}
          style={{
            minHeight: 48,
            justifyContent: "center",
            alignItems: "center",
          }}
        >
          <T style={{ color: C.action, fontWeight: "700" }}>
            Skip for now and explore
          </T>
        </Pressable>
      </View>
    </AppShell>
  );
}

function AuthErrorScreen() {
  const { refresh } = useCircles();
  return (
    <AppShell sidebar={false}>
      <Empty
        icon="cloud-offline-outline"
        title="We couldn’t check your sign-in."
        text="Reconnect, then try again. We haven’t loaded any private setup details."
        action="Try again"
        onAction={refresh}
      />
    </AppShell>
  );
}

function InterestChooser({
  selected,
  disabled,
  onToggle,
}: {
  selected: readonly InterestId[];
  disabled: boolean;
  onToggle: (interest: InterestId) => void;
}) {
  return (
    <View style={{ gap: 10 }}>
      {INTERESTS.map((interest) => {
        const checked = selected.includes(interest.id);
        const limitReached = !checked && selected.length >= MAX_INTERESTS;
        return (
          <Pressable
            key={interest.id}
            accessibilityRole="checkbox"
            accessibilityLabel={`${interest.label}, ${interest.category}`}
            accessibilityState={{ checked, disabled: disabled || limitReached }}
            disabled={disabled || limitReached}
            onPress={() => onToggle(interest.id)}
            style={({ pressed }) => ({
              minHeight: 52,
              borderRadius: 14,
              borderWidth: 1,
              borderColor: checked ? C.action : C.border,
              backgroundColor: checked ? C.soft : C.paper,
              paddingHorizontal: 14,
              paddingVertical: 10,
              flexDirection: "row",
              alignItems: "center",
              gap: 12,
              opacity: disabled || limitReached ? 0.52 : pressed ? 0.78 : 1,
            })}
          >
            <View
              style={{
                height: 24,
                width: 24,
                borderRadius: 12,
                alignItems: "center",
                justifyContent: "center",
                borderWidth: 1.5,
                borderColor: checked ? C.action : C.border,
                backgroundColor: checked ? C.action : C.paper,
              }}
            >
              {checked && <Icon name="checkmark" size={16} color="#fff" />}
            </View>
            <Icon
              name={interest.icon}
              color={checked ? C.action : C.secondary}
              size={20}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <T style={{ fontWeight: "700" }}>{interest.label}</T>
              <T style={{ color: C.secondary, fontSize: 12 }}>
                {interest.category}
              </T>
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

export function RecommendationCard({
  circle,
  reason,
  joined,
  pending,
  busy,
  onJoin,
}: {
  circle: Circle;
  reason: string;
  joined: boolean;
  pending: boolean;
  busy: boolean;
  onJoin: () => void;
}) {
  const canJoin = circle.privacy === "public" && !joined && !pending;
  return (
    <View style={[s.card, { padding: 16, gap: 10 }]}>
      <View style={[s.between, { gap: 12, alignItems: "flex-start" }]}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <T
            accessibilityLabel={circle.name}
            style={{ fontSize: 18, fontWeight: "800", flexShrink: 1 }}
          >
            {circle.name}
          </T>
          <T style={{ color: C.secondary, fontSize: 12 }}>
            {circle.memberCount}{" "}
            {circle.memberCount === 1 ? "member" : "members"} · {circle.privacy}{" "}
            circle
          </T>
        </View>
        <View
          style={{
            backgroundColor: C.sage,
            borderRadius: 8,
            paddingHorizontal: 8,
            paddingVertical: 5,
            alignSelf: "flex-start",
            flexShrink: 1,
            minWidth: 0,
            maxWidth: "45%",
          }}
        >
          <T
            accessibilityLabel={`Category: ${circle.category}`}
            ellipsizeMode="tail"
            numberOfLines={2}
            style={{
              color: C.secondary,
              flexShrink: 1,
              fontSize: 11,
              fontWeight: "700",
            }}
          >
            {circle.category}
          </T>
        </View>
      </View>
      <T style={{ color: C.secondary, lineHeight: 21 }}>{circle.description}</T>
      <View
        style={{
          borderLeftWidth: 2,
          borderLeftColor: C.coral,
          paddingLeft: 10,
        }}
      >
        <T style={{ color: C.ink, fontSize: 13, lineHeight: 19 }}>{reason}</T>
      </View>
      {joined ? (
        <View style={[s.row, { gap: 6, minHeight: 48 }]}>
          <Icon name="checkmark-circle" size={18} color={C.secondary} />
          <T style={{ color: C.secondary, fontWeight: "700" }}>Joined</T>
        </View>
      ) : pending ? (
        <View style={[s.row, { gap: 6, minHeight: 48 }]}>
          <Icon name="time-outline" size={18} color={C.secondary} />
          <T style={{ color: C.secondary, fontWeight: "700" }}>
            Request pending
          </T>
        </View>
      ) : circle.privacy !== "public" ? (
        <T style={{ color: C.secondary, fontSize: 12 }}>
          This circle is no longer open for immediate joining.
        </T>
      ) : (
        <Button
          title="Join circle"
          accessibilityLabel={`Join ${circle.name}`}
          secondary
          loading={busy}
          onPress={onJoin}
        />
      )}
      {canJoin && (
        <T style={{ color: C.secondary, fontSize: 11, lineHeight: 16 }}>
          Joining is your choice. Nothing is joined automatically.
        </T>
      )}
    </View>
  );
}

function CompletedScreen() {
  const router = useRouter();
  return (
    <View style={{ gap: 16, paddingTop: 12 }}>
      <T style={s.eyebrow}>SETUP COMPLETE</T>
      <T style={s.title}>Your Circles setup is ready.</T>
      <T style={{ color: C.secondary, lineHeight: 22 }}>
        You can update your private interests any time from your profile.
      </T>
      <Button
        title="Explore circles"
        onPress={() => router.replace("/circles")}
      />
      <Button
        title="Edit interests"
        secondary
        onPress={() => router.replace("/onboarding?edit=1")}
      />
    </View>
  );
}

function OnboardingWizard({
  accountId,
  status,
  editMode,
  currentAccountRef,
}: {
  accountId: number;
  status: OnboardingStatus;
  editMode: boolean;
  currentAccountRef: React.MutableRefObject<number | null>;
}) {
  const router = useRouter();
  const utils = trpc.useUtils();
  const [screen, setScreen] = useState<WizardScreen>(() =>
    initialWizardScreen(status, editMode),
  );
  const [selected, setSelected] = useState<InterestId[]>(
    () => status.interests,
  );
  const [joinedIds, setJoinedIds] = useState<Set<number>>(() => new Set());
  const [pendingIds, setPendingIds] = useState<Set<number>>(() => new Set());
  const [introductionCircleId, setIntroductionCircleId] = useState<
    number | null
  >(null);
  const [finishingDestination, setFinishingDestination] =
    useState<FinishDestination | null>(null);
  const [outcome, setOutcome] = useState<OnboardingOutcome | null>(null);

  const operationLock = useRef(false);
  const save = trpc.onboarding.save.useMutation();
  const finish = trpc.onboarding.finish.useMutation();
  const membership = trpc.social.setMembership.useMutation();
  const recommendations = trpc.onboarding.recommendations.useQuery(
    { limit: 6 },
    {
      enabled: screen === "circles" || screen === "first-post",
      retry: 1,
      staleTime: 0,
    },
  );
  const recommendationsForAccount =
    recommendations.data &&
    recommendations.data.userId === accountId &&
    recommendations.data.interests.length === selected.length &&
    selected.every((interest) =>
      recommendations.data!.interests.includes(interest),
    )
      ? recommendations.data
      : null;
  const cards = recommendationsForAccount?.items ?? [];
  const joinedPublicCircles = cards
    .map((item) => item.circle)
    .filter((circle) =>
      isIntroductionEligible(circle, joinedIds.has(circle.id)),
    );
  const controlsBusy =
    save.isPending ||
    finish.isPending ||
    membership.isPending ||
    finishingDestination !== null;

  function clearOutcome() {
    setOutcome(null);
  }

  function showOutcome(message: string, tone: OnboardingStatusTone) {
    setOutcome({ message, tone });
  }

  async function saveInterestsAndContinue() {
    if (operationLock.current || controlsBusy) return;
    operationLock.current = true;
    clearOutcome();
    try {
      const saved = await save.mutateAsync({
        interests: selected,
        step: "circles",
      });
      if (!isCurrentOnboardingAccount(accountId, currentAccountRef.current))
        return;
      if (saved.userId !== accountId)
        throw new Error("We couldn’t confirm setup for this account.");
      utils.onboarding.status.setData(undefined, saved);
      await utils.onboarding.recommendations.reset({ limit: 6 });
      if (!isCurrentOnboardingAccount(accountId, currentAccountRef.current))
        return;
      setScreen("circles");
    } catch {
      if (isCurrentOnboardingAccount(accountId, currentAccountRef.current)) {
        showOutcome(
          "Your interests couldn’t be saved. Please try again.",
          "error",
        );
      }
    } finally {
      operationLock.current = false;
    }
  }

  async function continueToIntroduction() {
    if (operationLock.current || controlsBusy || !joinedPublicCircles.length)
      return;
    operationLock.current = true;
    clearOutcome();
    try {
      const saved = await save.mutateAsync({
        interests: selected,
        step: "first-post",
      });
      if (!isCurrentOnboardingAccount(accountId, currentAccountRef.current))
        return;
      if (saved.userId !== accountId)
        throw new Error("We couldn’t confirm setup for this account.");
      utils.onboarding.status.setData(undefined, saved);
      setScreen("first-post");
    } catch {
      if (isCurrentOnboardingAccount(accountId, currentAccountRef.current)) {
        showOutcome("We couldn’t save this step. Please try again.", "error");
      }
    } finally {
      operationLock.current = false;
    }
  }

  async function backToSuggestions() {
    if (operationLock.current || controlsBusy) return;
    operationLock.current = true;
    clearOutcome();
    try {
      const saved = await save.mutateAsync({
        interests: selected,
        step: "circles",
      });
      if (!isCurrentOnboardingAccount(accountId, currentAccountRef.current))
        return;
      if (saved.userId !== accountId)
        throw new Error("We couldn’t confirm setup for this account.");
      utils.onboarding.status.setData(undefined, saved);
      setScreen("circles");
    } catch {
      if (isCurrentOnboardingAccount(accountId, currentAccountRef.current))
        showOutcome("We couldn’t save this step. Please try again.", "error");
    } finally {
      operationLock.current = false;
    }
  }

  async function joinCircle(circle: Circle) {
    if (operationLock.current || controlsBusy || circle.privacy !== "public")
      return;
    operationLock.current = true;
    clearOutcome();
    try {
      const result = await membership.mutateAsync({
        circleId: circle.id,
        joined: true,
      });
      if (!isCurrentOnboardingAccount(accountId, currentAccountRef.current))
        return;

      if (result.joined) {
        setJoinedIds((previous) => new Set(previous).add(circle.id));
        setPendingIds((previous) => {
          const next = new Set(previous);
          next.delete(circle.id);
          return next;
        });
        showOutcome(`You joined ${circle.name}.`, "success");
      } else {
        setPendingIds((previous) => new Set(previous).add(circle.id));
        showOutcome(
          "That circle now needs approval, so your request is pending.",
          "info",
        );
      }
      void utils.social.circles.invalidate();
      void utils.social.circlesPage.invalidate();
      void utils.onboarding.recommendations.invalidate();
    } catch {
      if (isCurrentOnboardingAccount(accountId, currentAccountRef.current)) {
        showOutcome("We couldn’t join that circle. Please try again.", "error");
      }
    } finally {
      operationLock.current = false;
    }
  }

  async function finishAndNavigate(
    destination: FinishDestination,
    circleId?: number,
  ) {
    if (operationLock.current || controlsBusy) return;
    operationLock.current = true;
    clearOutcome();
    setFinishingDestination(destination);
    try {
      if (destination === "intro") {
        if (!circleId) throw new Error("Choose a joined public circle first.");
        const circle = await utils.social.circle.fetch({ id: circleId });
        if (!isCurrentOnboardingAccount(accountId, currentAccountRef.current))
          return;
        if (!isIntroductionEligible(circle))
          throw new Error(
            "That circle is no longer available for this introduction. Choose a joined public circle or explore instead.",
          );
      }
      const finished = await finish.mutateAsync();
      if (!isCurrentOnboardingAccount(accountId, currentAccountRef.current))
        return;
      if (finished.userId !== accountId) {
        showOutcome(
          "We couldn’t confirm setup for this account. Please try again.",
          "error",
        );
        return;
      }
      utils.onboarding.status.setData(undefined, finished);
      void utils.onboarding.status.invalidate();
      if (destination === "intro" && circleId) {
        router.replace(`/create?mode=post&circleId=${circleId}&intro=1`);
      } else {
        router.replace("/circles");
      }
    } catch {
      if (isCurrentOnboardingAccount(accountId, currentAccountRef.current)) {
        showOutcome("We couldn’t finish setup. Please try again.", "error");
      }
    } finally {
      operationLock.current = false;
      if (isCurrentOnboardingAccount(accountId, currentAccountRef.current)) {
        setFinishingDestination(null);
      }
    }
  }

  if (screen === "interests") {
    return (
      <View style={{ gap: 18 }}>
        <View style={{ gap: 8 }}>
          <T style={s.eyebrow}>OPTIONAL SETUP · 1 OF 3</T>
          <T style={s.title}>What are you into?</T>
          <T style={{ color: C.secondary, lineHeight: 22 }}>
            Pick up to six interests for optional suggestions. These choices are
            private to your account and never appear on your profile.
          </T>
          <T style={{ color: C.secondary, fontSize: 12, fontWeight: "700" }}>
            {selected.length} of {MAX_INTERESTS} selected
          </T>
        </View>
        <InterestChooser
          selected={selected}
          disabled={controlsBusy}
          onToggle={(interest) =>
            setSelected((current) => toggleInterestSelection(current, interest))
          }
        />
        <Button
          title="Next: see circles"
          loading={save.isPending}
          disabled={controlsBusy}
          onPress={() => void saveInterestsAndContinue()}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Skip setup and explore circles"
          disabled={controlsBusy}
          onPress={() => void finishAndNavigate("circles")}
          style={({ pressed }) => ({
            minHeight: 48,
            alignItems: "center",
            justifyContent: "center",
            opacity: controlsBusy ? 0.55 : pressed ? 0.7 : 1,
          })}
        >
          <T style={{ color: C.action, fontWeight: "700" }}>
            Skip and explore circles
          </T>
        </Pressable>
        <StatusMessage
          message={outcome?.message}
          tone={outcome?.tone}
          testID="onboarding-status"
        />
      </View>
    );
  }

  if (screen === "circles") {
    const waitingForRecommendationAccount =
      recommendations.isLoading ||
      (recommendations.isFetching && !recommendationsForAccount);
    return (
      <View style={{ gap: 18 }}>
        <View style={{ gap: 8 }}>
          <T style={s.eyebrow}>OPTIONAL SETUP · 2 OF 3</T>
          <T style={s.title}>A few public circles to explore.</T>
          <T style={{ color: C.secondary, lineHeight: 22 }}>
            Suggestions are based on your private choices. Join only the
            communities you actually want to be part of.
          </T>
        </View>
        {waitingForRecommendationAccount ? (
          <Loading />
        ) : recommendations.isError ? (
          <Empty
            icon="cloud-offline-outline"
            title="We couldn’t load suggestions."
            text="Your interests are saved. Try again, or browse all public circles instead."
            action="Try again"
            onAction={() => void recommendations.refetch()}
          />
        ) : !recommendationsForAccount ? (
          <Empty
            icon="shield-checkmark-outline"
            title="We couldn’t confirm these suggestions."
            text="Please refresh before making a choice for this account."
            action="Refresh suggestions"
            onAction={() => void recommendations.refetch()}
          />
        ) : cards.length === 0 ? (
          <View style={[s.card, { padding: 18, gap: 10 }]}>
            <Icon name="compass-outline" color={C.coral} size={26} />
            <T style={{ fontSize: 18, fontWeight: "800" }}>
              No close matches yet.
            </T>
            <T style={{ color: C.secondary, lineHeight: 21 }}>
              There aren’t any suggestions to show right now. You can still
              browse every public circle.
            </T>
            <Button
              title="Browse all circles"
              secondary
              loading={controlsBusy}
              onPress={() => void finishAndNavigate("circles")}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Try suggestions again"
              disabled={controlsBusy}
              onPress={() => void recommendations.refetch()}
              style={{
                minHeight: 44,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <T style={{ color: C.action, fontWeight: "700" }}>
                Try suggestions again
              </T>
            </Pressable>
          </View>
        ) : (
          <View style={{ gap: 12 }}>
            {cards.map((item) => (
              <RecommendationCard
                key={item.circle.id}
                circle={item.circle}
                reason={item.reason}
                joined={
                  item.circle.joined === true || joinedIds.has(item.circle.id)
                }
                pending={
                  item.circle.role === "pending" ||
                  pendingIds.has(item.circle.id)
                }
                busy={membership.isPending}
                onJoin={() => void joinCircle(item.circle)}
              />
            ))}
          </View>
        )}
        <View style={{ gap: 9 }}>
          <Button
            title={
              joinedPublicCircles.length
                ? "Next: optional introduction"
                : "Explore circles"
            }
            loading={controlsBusy}
            onPress={() =>
              joinedPublicCircles.length
                ? void continueToIntroduction()
                : void finishAndNavigate("circles")
            }
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Edit interests"
            disabled={controlsBusy}
            onPress={() => setScreen("interests")}
            style={{
              minHeight: 44,
              justifyContent: "center",
              alignItems: "center",
            }}
          >
            <T style={{ color: C.action, fontWeight: "700" }}>Edit interests</T>
          </Pressable>
        </View>
        <StatusMessage
          message={outcome?.message}
          tone={outcome?.tone}
          testID="onboarding-status"
        />
      </View>
    );
  }

  const selectedCircle =
    joinedPublicCircles.find((circle) => circle.id === introductionCircleId) ??
    null;
  const introductionDestination = captureA26IntroductionCircleId(
    selectedCircle?.id,
  );
  return (
    <View style={{ gap: 18 }}>
      <View style={{ gap: 8 }}>
        <T style={s.eyebrow}>OPTIONAL SETUP · 3 OF 3</T>
        <T style={s.title}>A gentle first hello, if you’d like.</T>
        <T style={{ color: C.secondary, lineHeight: 22 }}>
          A short introduction can help people know why you’re here. Keep it
          kind, share only what feels comfortable, and make room for a reply.
        </T>
        <T style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}>
          Circles etiquette, not a circle-specific rule. Nothing will publish
          until you review and choose to post.
        </T>
      </View>
      <View style={[s.card, { padding: 16, gap: 7 }]}>
        <T style={s.eyebrow}>EDITABLE DRAFT PREVIEW</T>
        <T style={{ color: C.ink, fontSize: 15, lineHeight: 23 }}>
          Hi everyone! I’m new here. One thing I’d love to share or learn with
          this circle is…
        </T>
      </View>
      <View style={{ gap: 9 }}>
        <T style={{ fontWeight: "800", fontSize: 16 }}>
          Choose a joined public circle
        </T>
        {joinedPublicCircles.map((circle) => {
          const selectedCircleOption = circle.id === introductionCircleId;
          return (
            <Pressable
              key={circle.id}
              accessibilityRole="radio"
              accessibilityLabel={`Introduce yourself in ${circle.name}`}
              accessibilityState={{
                selected: selectedCircleOption,
                disabled: controlsBusy,
              }}
              disabled={controlsBusy}
              onPress={() => {
                if (
                  !canChangeA26IntroductionCircle({
                    controlsBusy,
                    operationLocked: operationLock.current,
                  })
                ) {
                  return;
                }
                setIntroductionCircleId(circle.id);
              }}
              style={({ pressed }) => ({
                minHeight: 52,
                borderRadius: 13,
                borderWidth: 1,
                borderColor: selectedCircleOption ? C.action : C.border,
                backgroundColor: selectedCircleOption ? C.soft : C.paper,
                paddingHorizontal: 14,
                paddingVertical: 10,
                flexDirection: "row",
                alignItems: "center",
                gap: 10,
                opacity: controlsBusy ? 0.52 : pressed ? 0.75 : 1,
              })}
            >
              <Icon
                name={
                  selectedCircleOption ? "radio-button-on" : "radio-button-off"
                }
                color={selectedCircleOption ? C.action : C.secondary}
                size={20}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <T style={{ fontWeight: "700" }}>{circle.name}</T>
                <T style={{ color: C.secondary, fontSize: 12 }}>
                  {circle.memberCount}{" "}
                  {circle.memberCount === 1 ? "member" : "members"} · public
                </T>
              </View>
            </Pressable>
          );
        })}
      </View>
      <Button
        title="Open my editable introduction"
        disabled={!introductionDestination || controlsBusy}
        loading={controlsBusy}
        onPress={() => {
          if (!introductionDestination) return;
          void finishAndNavigate("intro", introductionDestination);
        }}
      />
      <Button
        title="Not now — explore circles"
        secondary
        loading={controlsBusy}
        onPress={() => void finishAndNavigate("circles")}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back to circle suggestions"
        disabled={controlsBusy}
        onPress={() => void backToSuggestions()}
        style={{
          minHeight: 44,
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <T style={{ color: C.action, fontWeight: "700" }}>
          Back to suggestions
        </T>
      </Pressable>
      <StatusMessage
        message={outcome?.message}
        tone={outcome?.tone}
        testID="onboarding-status"
      />
    </View>
  );
}

export default function OnboardingScreen() {
  const { user, authLoading, authState } = useCircles();
  const params = useLocalSearchParams<{ edit?: string | string[] }>();
  const currentAccountId =
    authState === "authenticated" ? (user?.id ?? null) : null;
  const currentAccountRef = useRef<number | null>(null);
  useEffect(() => {
    currentAccountRef.current = currentAccountId;
  }, [currentAccountId]);
  const editMode = isEditMode(params.edit);
  const status = trpc.onboarding.status.useQuery(undefined, {
    enabled: authState === "authenticated" && !!user,
    refetchOnMount: "always",
    staleTime: 0,
    retry: 1,
  });
  const currentStatus = hydrateOnboardingForAccount(status.data, user?.id);

  if (authLoading || authState === "checking") {
    return (
      <AppShell sidebar={false}>
        <Loading />
      </AppShell>
    );
  }
  if (authState === "guest") return <OptionalGuestScreen />;
  if (authState === "error" || !user) return <AuthErrorScreen />;
  if (status.isLoading || (status.isFetching && !currentStatus)) {
    return (
      <AppShell sidebar={false}>
        <Loading />
      </AppShell>
    );
  }
  if (status.isError) {
    return (
      <AppShell sidebar={false}>
        <Empty
          icon="cloud-offline-outline"
          title="We couldn’t load your setup."
          text="Your private interests weren’t shown. Check your connection and try again."
          action="Try again"
          onAction={() => void status.refetch()}
        />
      </AppShell>
    );
  }
  if (!currentStatus) {
    return (
      <AppShell sidebar={false}>
        <Empty
          icon="shield-checkmark-outline"
          title="We couldn’t confirm this setup."
          text="Refresh to load preferences for the account you’re signed into."
          action="Refresh"
          onAction={() => void status.refetch()}
        />
      </AppShell>
    );
  }

  return (
    <AppShell sidebar={false}>
      {currentStatus.step === "complete" && !editMode ? (
        <CompletedScreen />
      ) : (
        <OnboardingWizard
          key={`onboarding-account-${user.id}`}
          accountId={user.id}
          status={currentStatus}
          editMode={editMode}
          currentAccountRef={currentAccountRef}
        />
      )}
    </AppShell>
  );
}
