import React, { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";
import { usePathname, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { trpc } from "@/lib/trpc";
import { useCircles } from "@/hooks/circles-context";
import {
  getA26CurrentAvatar,
  getA26OwnProfileQueryInput,
} from "../lib/a26-directory-ui";
import { appShellLayout } from "@/lib/app-shell-layout";
import type { StatusTone } from "@/lib/status-announcement";
import {
  resolveAppNavigationSection,
  type AppNavigationSection,
} from "@/lib/app-navigation-state";
import {
  batch1OperationIdentityMatches,
  batch1OperationKey,
  createBatch1OperationGuard,
  createBatch1OperationInstance,
  type Batch1OperationScope,
} from "../lib/batch1-mutation-feedback";
import { invalidateCircleDirectories } from "../lib/source-query-invalidation";
import {
  Button,
  C,
  Icon,
  IconButton,
  Logo,
  photo,
  s,
  T,
  Wordmark,
  type IconName,
} from "./circles-ui";
import { Image } from "@/components/media-image";
import { ActivityBadge } from "./activity-badge";
import { StatusMessage } from "./status-message";
import { UserAvatar } from "./user-avatar";

export const navigation: {
  label: string;
  path: string;
  icon: IconName;
  active: IconName;
  section: AppNavigationSection;
}[] = [
  {
    label: "Home",
    path: "/",
    icon: "home-outline",
    active: "home",
    section: "home",
  },
  {
    label: "Discover",
    path: "/discover",
    icon: "compass-outline",
    active: "compass",
    section: "discover",
  },
  {
    label: "My circles",
    path: "/circles",
    icon: "ellipse-outline",
    active: "ellipse",
    section: "circles",
  },
  {
    label: "Updates",
    path: "/updates",
    icon: "notifications-outline",
    active: "notifications",
    section: "updates",
  },
  {
    label: "Messages",
    path: "/messages",
    icon: "chatbubble-ellipses-outline",
    active: "chatbubble-ellipses",
    section: "messages",
  },
  {
    label: "Profile",
    path: "/profile",
    icon: "person-outline",
    active: "person",
    section: "profile",
  },
];
export function AppShell({
  children,
  scroll = true,
  sidebar = true,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  sidebar?: boolean;
}) {
  const { width } = useWindowDimensions();
  const router = useRouter();
  const path = usePathname();
  const { user, requireAuth, showLogin } = useCircles();
  const insets = useSafeAreaInsets();
  const layout = appShellLayout(width, insets);
  const { wide, gutter } = layout;
  const selectedSection = resolveAppNavigationSection(path);
  const ownProfileInput = getA26OwnProfileQueryInput(user?.id);
  const myProfile = trpc.social.profile.useQuery(ownProfileInput, {
    enabled: ownProfileInput !== undefined,
  });
  const ownAvatar = getA26CurrentAvatar(user?.id, myProfile.data);
  return (
    <View
      testID="app-shell-frame"
      style={{
        flex: 1,
        backgroundColor: C.bg,
        ...layout.framePadding,
      }}
    >
      <View
        style={{
          borderBottomWidth: 1,
          borderBottomColor: C.border,
          backgroundColor: C.bg,
        }}
      >
        <View
          testID="app-shell-header"
          style={{
            width: "100%",
            maxWidth: 1270,
            alignSelf: "center",
            minHeight: wide ? 86 : 70,
            paddingHorizontal: layout.headerGutter,
            paddingVertical: 12,
            flexDirection: "row",
            flexWrap: "wrap",
            columnGap: 16,
            rowGap: 8,
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Circles home"
            onPress={() => router.push("/")}
            style={{
              minHeight: 44,
              maxWidth: "100%",
              justifyContent: "center",
            }}
          >
            <Wordmark />
          </Pressable>
          {wide && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Search Circles"
              onPress={() => router.push("/discover")}
              style={{
                width: 370,
                maxWidth: "100%",
                borderWidth: 1,
                borderColor: C.border,
                backgroundColor: "#F1F2EB",
                borderRadius: 30,
                paddingHorizontal: 17,
                paddingVertical: 11,
                flexDirection: "row",
                gap: 12,
                alignItems: "center",
                minHeight: 44,
              }}
            >
              <Icon name="search-outline" size={18} color={C.muted} />
              <T style={{ flex: 1, minWidth: 0, fontSize: 12, color: C.muted }}>
                Find your people, circles, and inspiration
              </T>
              <View
                style={{
                  marginLeft: "auto",
                  borderWidth: 1,
                  borderColor: "#DCDDDA",
                  borderRadius: 5,
                  paddingHorizontal: 5,
                }}
              >
                <T style={{ fontSize: 10, color: C.muted }}>⌘ K</T>
              </View>
            </Pressable>
          )}
          <View
            testID="app-shell-header-actions"
            style={[
              s.row,
              {
                gap: wide ? 13 : 6,
                flexWrap: "nowrap",
                flexShrink: 0,
                marginLeft: "auto",
              },
            ]}
          >
            {!wide && (
              <IconButton
                icon="search-outline"
                onPress={() => router.push("/discover")}
                label="Search Circles"
              />
            )}
            <IconButton
              icon="chatbubble-ellipses-outline"
              onPress={() => router.push("/messages")}
              label="Open messages"
            />
            {user && (
              <ActivityBadge
                viewerId={user.id}
                onPress={() => router.push("/updates")}
              />
            )}
            {wide && (
              <>
                <View
                  style={{
                    width: 1,
                    height: 25,
                    backgroundColor: C.border,
                    marginHorizontal: 6,
                  }}
                />
                <Pressable
                  onPress={() => (user ? router.push("/profile") : showLogin())}
                  accessibilityRole="button"
                  accessibilityLabel="Open your profile"
                  style={{
                    minWidth: 44,
                    minHeight: 44,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <UserAvatar
                    uri={ownAvatar}
                    name={user?.name || "You"}
                    size={35}
                    userId={user?.id}
                  />
                </Pressable>
              </>
            )}
          </View>
        </View>
      </View>
      <View
        style={{
          flex: 1,
          width: "100%",
          maxWidth: 1270,
          alignSelf: "center",
          flexDirection: "row",
        }}
      >
        {wide && (
          <View
            testID="app-shell-wide-rail"
            style={{
              width: 226,
              borderRightWidth: 1,
              borderColor: C.border,
              paddingHorizontal: 25,
              paddingTop: 30,
              paddingBottom: Math.max(24, insets.bottom + 16),
            }}
          >
            <T style={[s.eyebrow, { marginBottom: 22, paddingLeft: 14 }]}>
              YOUR SPACE
            </T>
            <View style={{ gap: 7 }}>
              {navigation.map((item) => {
                const selected = selectedSection === item.section;
                return (
                  <Pressable
                    key={item.path}
                    onPress={() => router.push(item.path as any)}
                    accessibilityRole="button"
                    accessibilityLabel={`Open ${item.label}`}
                    accessibilityState={{ selected }}
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 15,
                      paddingVertical: 14,
                      paddingHorizontal: 15,
                      minHeight: 44,
                      borderRadius: 12,
                      backgroundColor: selected ? C.soft : "transparent",
                    }}
                  >
                    <Icon
                      name={selected ? item.active : item.icon}
                      color={selected ? C.action : C.muted}
                      size={22}
                    />
                    <T
                      style={{
                        fontWeight: selected ? "700" : "500",
                        color: selected ? C.action : C.ink,
                        fontSize: 13,
                      }}
                    >
                      {item.label}
                    </T>
                    {selected && (
                      <View
                        style={{
                          marginLeft: "auto",
                          width: 5,
                          height: 5,
                          borderRadius: 3,
                          backgroundColor: C.action,
                        }}
                      />
                    )}
                  </Pressable>
                );
              })}
              <Pressable
                onPress={() => router.push("/live")}
                accessibilityRole="button"
                accessibilityLabel="Open Live now"
                accessibilityState={{ selected: selectedSection === "live" }}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 15,
                  paddingVertical: 14,
                  paddingHorizontal: 15,
                  minHeight: 44,
                  borderRadius: 12,
                  backgroundColor:
                    selectedSection === "live" ? C.soft : "transparent",
                }}
              >
                <Icon
                  name="radio-outline"
                  color={selectedSection === "live" ? C.action : C.muted}
                />
                <T
                  style={{
                    fontSize: 13,
                    fontWeight: selectedSection === "live" ? "700" : "500",
                    color: selectedSection === "live" ? C.action : C.ink,
                  }}
                >
                  Live now
                </T>
                <View
                  style={{
                    width: 6,
                    height: 6,
                    backgroundColor:
                      selectedSection === "live" ? C.action : C.coral,
                    borderRadius: 3,
                    marginLeft: "auto",
                  }}
                />
              </Pressable>
            </View>
            <Button
              title="Create a post"
              icon="add"
              onPress={() => requireAuth(() => router.push("/create"))}
              style={{ marginTop: 29 }}
            />
            <View style={{ marginTop: "auto", paddingTop: 35, gap: 15 }}>
              <View style={s.divider} />
              <T style={{ color: C.muted, fontSize: 11, lineHeight: 19 }}>
                Less scrolling. More belonging.
              </T>
              <View style={[s.row, { gap: 7 }]}>
                <Logo size={17} color="#A8ADA1" />
                <T style={{ fontSize: 10, color: "#A3A79C" }}>© 2026 Circles</T>
              </View>
            </View>
          </View>
        )}
        <View style={{ flex: 1, minWidth: 0 }}>
          {scroll ? (
            <ScrollView
              showsHorizontalScrollIndicator={false}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              automaticallyAdjustKeyboardInsets
              contentContainerStyle={{
                padding: gutter,
                paddingBottom: Math.max(32, insets.bottom + 16),
                width: "100%",
                maxWidth: 760,
                alignSelf: "center",
              }}
            >
              {children}
            </ScrollView>
          ) : (
            <View
              style={{
                flex: 1,
                width: "100%",
                maxWidth: 760,
                alignSelf: "center",
              }}
            >
              {children}
            </View>
          )}
        </View>
        {layout.showSidebar && sidebar && (
          <ScrollView
            testID="app-shell-community-sidebar"
            showsHorizontalScrollIndicator={false}
            style={{
              width: 296,
              maxWidth: 296,
              borderLeftWidth: 1,
              borderLeftColor: C.border,
            }}
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{
              paddingHorizontal: 24,
              paddingTop: 30,
              paddingBottom: Math.max(30, insets.bottom + 16),
            }}
          >
            <CommunitySidebar />
          </ScrollView>
        )}
      </View>
    </View>
  );
}
type SidebarJoinError = {
  scope: Batch1OperationScope;
  message: string;
};

type SidebarCircle = {
  id: number;
  name: string;
  image: string;
  memberCount: number;
  category: string;
  privacy: "public" | "private";
  joined?: boolean;
  role?: string | null;
};

function SidebarCircleRow({
  accountId,
  circle,
  onOpen,
  requireAuth,
  notify,
}: {
  accountId: number | null;
  circle: SidebarCircle;
  onOpen: () => void;
  requireAuth: (action: () => void) => void;
  notify: (message: string, tone?: StatusTone) => void;
}) {
  const utils = trpc.useUtils();
  const join = trpc.social.joinCircle.useMutation();
  const mountedRef = useRef(false);
  const scopeRef = useRef<Batch1OperationScope | null>(null);
  const [operationInstance] = useState(() => createBatch1OperationInstance());
  const [joinGuard] = useState(() => createBatch1OperationGuard());
  const [pendingJoinScope, setPendingJoinScope] =
    useState<Batch1OperationScope | null>(null);
  const [joinError, setJoinError] = useState<SidebarJoinError | null>(null);
  const identity = React.useMemo(
    () => operationInstance.createIdentity(accountId, `circle:${circle.id}`),
    [accountId, circle.id, operationInstance],
  );

  useEffect(() => {
    mountedRef.current = true;
    const scope = operationInstance.activate(identity);
    scopeRef.current = scope;
    return () => {
      mountedRef.current = false;
      operationInstance.deactivate(scope);
      if (scopeRef.current?.instanceId === scope?.instanceId) {
        scopeRef.current = null;
      }
    };
  }, [identity, operationInstance]);

  function scopeIsCurrent(scope: Batch1OperationScope): boolean {
    return mountedRef.current && operationInstance.isCurrent(scope);
  }

  function requestJoin() {
    const startJoin = () => {
      const scope = scopeRef.current;
      if (!scope) return;

      void joinGuard.run(scope, async () => {
        setPendingJoinScope(scope);
        setJoinError((current) =>
          current &&
          batch1OperationKey(current.scope) === batch1OperationKey(scope)
            ? null
            : current,
        );
        try {
          const result = await join.mutateAsync({ circleId: circle.id });
          if (!scopeIsCurrent(scope)) return;
          void invalidateCircleDirectories(utils);
          notify(
            result.role === "pending"
              ? "Your request is with the circle owner."
              : "You’re a little closer. Circle joined!",
            "success",
          );
        } catch {
          if (!scopeIsCurrent(scope)) return;
          const message =
            circle.privacy === "private"
              ? `Couldn’t request to join ${circle.name}. Check your connection and try again.`
              : `Couldn’t join ${circle.name}. Check your connection and try again.`;
          setJoinError({ scope, message });
          notify(message, "error");
        } finally {
          if (!scopeIsCurrent(scope)) return;
          setPendingJoinScope((current) =>
            current && batch1OperationKey(current) === batch1OperationKey(scope)
              ? null
              : current,
          );
        }
      });
    };

    requireAuth(startJoin);
  }

  const isJoining =
    pendingJoinScope !== null &&
    batch1OperationIdentityMatches(pendingJoinScope, identity);
  const visibleJoinError =
    joinError && batch1OperationIdentityMatches(joinError.scope, identity)
      ? joinError.message
      : null;
  const requested = circle.role === "pending";
  const actionLabel = circle.joined
    ? `Open ${circle.name}`
    : requested
      ? `Membership requested for ${circle.name}`
      : circle.privacy === "private"
        ? `Request to join ${circle.name}`
        : `Join ${circle.name}`;

  return (
    <View style={{ gap: 6 }}>
      <View style={[s.row, { gap: 10 }]}>
        <Pressable
          onPress={onOpen}
          accessibilityRole="button"
          accessibilityLabel={`Open ${circle.name}`}
          style={[s.row, { flex: 1, minWidth: 0, minHeight: 46, gap: 10 }]}
        >
          <Image
            source={{ uri: circle.image }}
            accessible={false}
            style={{ width: 46, height: 46, borderRadius: 13 }}
            contentFit="cover"
          />
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <T style={{ fontSize: 12, fontWeight: "700" }}>{circle.name}</T>
            <T style={{ fontSize: 10, color: C.muted }}>
              {circle.memberCount}{" "}
              {circle.memberCount === 1 ? "member" : "members"} ·{" "}
              {circle.category}
            </T>
          </View>
        </Pressable>
        <Button
          title={circle.joined ? "Open" : requested ? "Requested" : "Join"}
          accessibilityLabel={actionLabel}
          secondary={circle.joined || requested}
          loading={isJoining}
          disabled={requested}
          onPress={circle.joined ? onOpen : requestJoin}
          style={{
            minWidth: 48,
            borderRadius: 7,
            paddingHorizontal: 10,
            paddingVertical: 10,
          }}
        />
      </View>
      {visibleJoinError && (
        <T
          accessibilityLiveRegion="polite"
          style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}
        >
          {visibleJoinError}
        </T>
      )}
    </View>
  );
}

export function CommunitySidebar() {
  const router = useRouter();
  const circles = trpc.social.circles.useQuery({});
  const { user, requireAuth, notify } = useCircles();
  const accountId = user?.id ?? null;
  const recommendedCircles = circles.data ?? [];

  return (
    <View style={{ gap: 27 }}>
      <View style={{ gap: 16 }}>
        <View style={s.between}>
          <T style={{ fontSize: 16, fontWeight: "700", letterSpacing: -0.3 }}>
            Find your circles
          </T>
          <Icon name="sparkles-outline" size={18} color={C.coral} />
        </View>
        <T style={{ color: C.muted, fontSize: 12, lineHeight: 19 }}>
          Small communities. Big connections.
        </T>
        {circles.isLoading ? (
          <T
            testID="sidebar-circles-loading"
            style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}
          >
            Loading circle recommendations…
          </T>
        ) : circles.isError ? (
          <View testID="sidebar-circles-error" style={{ gap: 10 }}>
            <StatusMessage
              message="We couldn’t load circle recommendations. Check your connection and try again."
              tone="error"
            />
            <Button
              title="Try again"
              secondary
              onPress={() => {
                void circles.refetch();
              }}
              style={{ alignSelf: "flex-start" }}
            />
          </View>
        ) : recommendedCircles.length === 0 ? (
          <T
            testID="sidebar-circles-empty"
            style={{ color: C.secondary, fontSize: 12, lineHeight: 18 }}
          >
            No circle recommendations right now.
          </T>
        ) : (
          recommendedCircles
            .slice(0, 3)
            .map((circle) => (
              <SidebarCircleRow
                key={`${accountId ?? "anonymous"}:${circle.id}`}
                accountId={accountId}
                circle={circle}
                onOpen={() => router.push(`/circle/${circle.id}`)}
                requireAuth={requireAuth}
                notify={notify}
              />
            ))
        )}
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/circles")}
          style={{ minHeight: 44, justifyContent: "center" }}
        >
          <T style={{ color: C.action, fontWeight: "600", fontSize: 12 }}>
            Explore all circles ↗
          </T>
        </Pressable>
      </View>
      <View style={s.divider} />
      <View
        style={{
          borderRadius: 17,
          backgroundColor: C.sage,
          padding: 19,
          overflow: "hidden",
          gap: 12,
        }}
      >
        <View
          style={{
            alignSelf: "flex-start",
            backgroundColor: "#FAFCF7",
            borderRadius: 8,
            padding: 8,
          }}
        >
          <Icon name="leaf-outline" color={C.green} size={21} />
        </View>
        <T
          style={{
            fontSize: 20,
            fontWeight: "700",
            lineHeight: 26,
            letterSpacing: -0.6,
          }}
        >
          {"Good things start\nwith a circle."}
        </T>
        <T style={{ color: C.secondary, fontSize: 12, lineHeight: 19 }}>
          A space for your people, your passions, and everything in between.
        </T>
        <Button
          title="Make it yours"
          secondary
          icon="add"
          onPress={() => requireAuth(() => router.push("/create?mode=circle"))}
          style={{
            backgroundColor: "transparent",
            borderColor: "#BAC6B3",
            borderRadius: 10,
            paddingVertical: 10,
          }}
        />
      </View>
      <View style={{ gap: 13 }}>
        <T style={s.eyebrow}>THE CIRCLES WAY</T>
        <T style={{ color: C.muted, fontSize: 12, lineHeight: 20 }}>
          {"Be yourself. Be kind.\nMake room for someone new."}
        </T>
        <Image
          source={{ uri: photo.coffee }}
          style={{ height: 118, width: "100%", borderRadius: 13 }}
          contentFit="cover"
        />
        <T style={{ color: C.secondary, fontSize: 10, lineHeight: 17 }}>
          Community preview · Example creator profiles and curated starter
          posts.
        </T>
      </View>
    </View>
  );
}
