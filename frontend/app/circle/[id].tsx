import { useEffect, useState } from "react";
import { Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";

import { apiGet, apiPost, apiPut, mediaUrl } from "@/src/api/client";
import type { Circle } from "@/src/components/circle-card";
import { PostCard, type Post } from "@/src/components/post-card";
import { Avatar, Body, Button, Display, EmptyState, Loading, Overline } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { EventComposer } from "@/src/components/event-composer";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

type TabKey = "posts" | "events" | "about" | "people";
type CircleEvent = { id: string; title: string; description: string; starts_at: string; host_name: string; rsvp_count: number; going: boolean };
type Member = { id: string; name: string; avatar_url: string | null; role: string };

export default function CircleDetail() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [tab, setTab] = useState<TabKey>("posts");
  const [eventModal, setEventModal] = useState(false);
  const [welcome, setWelcome] = useState("");
  const [editingWelcome, setEditingWelcome] = useState(false);

  const { data: circle, isLoading } = useQuery({
    queryKey: ["circle", id],
    queryFn: () => apiGet<Circle>(`/api/circles/${id}`),
  });
  const { data: posts } = useQuery({
    queryKey: ["circle-posts", id],
    queryFn: () => apiGet<Post[]>(`/api/circles/${id}/posts`),
    enabled: tab === "posts",
  });
  const { data: events } = useQuery({
    queryKey: ["circle-events", id],
    queryFn: () => apiGet<CircleEvent[]>(`/api/circles/${id}/events`),
    enabled: tab === "events",
  });
  const { data: members } = useQuery({
    queryKey: ["circle-members", id],
    queryFn: () => apiGet<Member[]>(`/api/circles/${id}/members`),
    enabled: tab === "about" || tab === "people",
  });

  const rsvp = async (ev: CircleEvent) => {
    qc.setQueryData<CircleEvent[]>(["circle-events", id], (old) =>
      (old ?? []).map((e) => (e.id === ev.id ? { ...e, going: !e.going, rsvp_count: e.rsvp_count + (e.going ? -1 : 1) } : e)),
    );
    await apiPost(`/api/events/${ev.id}/rsvp`, {}).catch(() => {});
  };

  const messageMember = async (m: Member) => {
    try {
      const conv = await apiPost<{ id: string }>("/api/conversations/direct", { user_id: m.id });
      router.push(`/chat/${conv.id}?title=${encodeURIComponent(m.name)}`);
    } catch {
      toast.show("Could not open chat", "error");
    }
  };

  useEffect(() => {
    if (circle?.welcome_message != null) setWelcome(circle.welcome_message);
  }, [circle?.welcome_message]);

  const saveWelcome = async () => {
    try {
      await apiPut(`/api/circles/${id}`, { welcome_message: welcome.trim() });
      qc.invalidateQueries({ queryKey: ["circle", id] });
      setEditingWelcome(false);
      toast.show("Welcome message pinned", "success");
    } catch {
      toast.show("Could not save", "error");
    }
  };

  const toggleModerator = async (m: Member) => {
    const next = m.role === "moderator" ? "member" : "moderator";
    try {
      await apiPost(`/api/circles/${id}/members/${m.id}/role`, { role: next });
      qc.invalidateQueries({ queryKey: ["circle-members", id] });
      toast.show(next === "moderator" ? `${m.name.split(" ")[0]} is now a moderator` : "Moderator removed", "success");
    } catch (e: any) {
      toast.show(e?.message ?? "Could not update role", "error");
    }
  };

  const toggleJoin = async () => {
    if (!circle) return;
    try {
      await apiPost(`/api/circles/${id}/${circle.is_member ? "leave" : "join"}`, {});
      qc.invalidateQueries({ queryKey: ["circle", id] });
      qc.invalidateQueries({ queryKey: ["circles"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      toast.show(circle.is_member ? "Left circle" : `Joined ${circle.name}`, "success");
    } catch {
      toast.show("Something went wrong", "error");
    }
  };

  const toggleLike = async (post: Post) => {
    qc.setQueryData<Post[]>(["circle-posts", id], (old) =>
      (old ?? []).map((p) => (p.id === post.id ? { ...p, liked: !p.liked, like_count: p.like_count + (p.liked ? -1 : 1) } : p)),
    );
    await apiPost(`/api/posts/${post.id}/like`, {}).catch(() => {});
  };

  if (isLoading || !circle) return <View style={styles.root}><Loading /></View>;

  return (
    <View style={styles.root}>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: insets.bottom + spacing["2xl"] }}>
        <View style={styles.hero}>
          {circle.cover_url ? (
            <Image source={{ uri: mediaUrl(circle.cover_url) }} style={styles.heroImg} contentFit="cover" />
          ) : (
            <View style={[styles.heroImg, { backgroundColor: colors.brandTertiary }]} />
          )}
          <LinearGradient colors={["rgba(42,37,34,0.2)", "rgba(42,37,34,0.85)"]} style={styles.heroScrim} />
          <Pressable testID="circle-back" style={[styles.back, { top: insets.top + spacing.sm }]} onPress={() => router.back()}>
            <Icon name="arrow-left" size={22} color="#FFFFFF" />
          </Pressable>
          <View style={styles.heroContent}>
            <Body size={11} weight="medium" color="#F4D5CA" style={{ letterSpacing: 1.2, fontFamily: fonts.textMedium }}>
              {circle.category.toUpperCase()}
            </Body>
            <Display size={28} weight="semibold" style={{ color: "#FFFFFF" }}>{circle.name}</Display>
            <View style={styles.metaRow}>
              <Icon name="users" size={14} color="#F2EBE5" />
              <Body size={13} color="#F2EBE5">{circle.member_count} members</Body>
            </View>
          </View>
        </View>

        <View style={styles.actions}>
          <Button
            testID="circle-join"
            label={circle.is_member ? "Joined" : "Join circle"}
            variant={circle.is_member ? "secondary" : "primary"}
            icon={circle.is_member ? "check" : "plus"}
            onPress={toggleJoin}
            style={{ flex: 1 }}
          />
          {circle.is_member ? (
            <Button
              testID="circle-chat"
              label="Chat"
              variant="ghost"
              icon="message-circle"
              onPress={async () => {
                const conv = await apiGet<{ id: string }[]>("/api/conversations");
                const match = conv.find((c: any) => c.circle_id === id);
                if (match) router.push(`/chat/${match.id}?title=${encodeURIComponent(circle.name)}`);
                else toast.show("Opening chat…", "info");
              }}
            />
          ) : null}
        </View>

        <View style={styles.tabs}>
          {(["posts", "events", "about", "people"] as TabKey[]).map((t) => (
            <Pressable key={t} testID={`tab-${t}`} style={styles.tab} onPress={() => setTab(t)}>
              <Body size={14} weight="medium" color={tab === t ? colors.onSurface : colors.muted} style={{ fontFamily: fonts.textMedium }}>
                {t[0].toUpperCase() + t.slice(1)}
              </Body>
              {tab === t ? <View style={styles.tabUnderline} /> : null}
            </Pressable>
          ))}
        </View>

        {tab === "posts" ? (
          <>
            {circle.welcome_message ? (
              <View style={styles.welcome} testID="welcome-banner">
                <Icon name="bookmark" size={16} color={colors.onBrandTertiary} />
                <Body size={14} color={colors.onSurface} style={{ flex: 1, lineHeight: 20 }}>
                  {circle.welcome_message}
                </Body>
              </View>
            ) : null}
            {(posts ?? []).length === 0 ? (
              <View style={{ marginTop: spacing["2xl"] }}>
                <EmptyState icon="feather" title="No posts yet" message="Be the first to post in this circle." />
              </View>
            ) : (
              (posts ?? []).map((p) => <PostCard key={p.id} post={p} onToggleLike={toggleLike} />)
            )}
          </>
        ) : null}

        {tab === "events" ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            {circle.is_member ? (
              <Button testID="schedule-event" label="Schedule an event" icon="calendar" variant="secondary" onPress={() => setEventModal(true)} />
            ) : null}
            {(events ?? []).length === 0 ? (
              <View style={{ marginTop: spacing.xl }}>
                <EmptyState icon="calendar" title="No events scheduled" message="Events hosted in this circle will show up here." />
              </View>
            ) : (
              (events ?? []).map((e) => (
                <View key={e.id} style={styles.eventCard} testID={`event-${e.id}`}>
                  <Overline>{formatDateTime(e.starts_at)}</Overline>
                  <Display size={18} weight="medium">{e.title}</Display>
                  {e.description ? <Body size={14} color={colors.onSurfaceSecondary}>{e.description}</Body> : null}
                  <View style={styles.eventFooter}>
                    <Body size={12} color={colors.muted}>{e.rsvp_count} going · {e.host_name}</Body>
                    <Button
                      testID={`rsvp-${e.id}`}
                      small
                      label={e.going ? "Going" : "RSVP"}
                      icon={e.going ? "check" : "plus"}
                      variant={e.going ? "secondary" : "primary"}
                      onPress={() => rsvp(e)}
                    />
                  </View>
                </View>
              ))
            )}
          </View>
        ) : null}

        {tab === "about" ? (
          <View style={{ padding: spacing.lg, gap: spacing.lg }}>
            <View style={{ gap: spacing.sm }}>
              <Overline>About</Overline>
              <Body size={15} color={colors.onSurfaceSecondary} style={{ lineHeight: 24 }}>{circle.description}</Body>
            </View>
            {circle.is_owner ? (
              <View style={{ gap: spacing.sm }}>
                <Overline>Pinned welcome message</Overline>
                {editingWelcome ? (
                  <>
                    <TextInput
                      testID="welcome-input"
                      value={welcome}
                      onChangeText={setWelcome}
                      placeholder="Welcome new members with a note…"
                      placeholderTextColor={colors.muted}
                      multiline
                      style={styles.welcomeInput}
                    />
                    <View style={{ flexDirection: "row", gap: spacing.sm }}>
                      <Button testID="welcome-save" small label="Save" onPress={saveWelcome} style={{ flex: 1 }} />
                      <Button small variant="ghost" label="Cancel" onPress={() => setEditingWelcome(false)} style={{ flex: 1 }} />
                    </View>
                  </>
                ) : (
                  <Pressable testID="welcome-edit" style={styles.welcomeEdit} onPress={() => setEditingWelcome(true)}>
                    <Body size={14} color={circle.welcome_message ? colors.onSurface : colors.muted} style={{ flex: 1 }}>
                      {circle.welcome_message || "Add a welcome message for new members"}
                    </Body>
                    <Icon name="edit-2" size={16} color={colors.brandPrimary} />
                  </Pressable>
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        {tab === "people" ? (
          <View style={{ padding: spacing.lg, gap: spacing.md }}>
            <Overline>{(members ?? []).length} members</Overline>
            {(members ?? []).map((m) => (
              <View key={m.id} style={styles.memberRow} testID={`member-${m.id}`}>
                <Pressable style={styles.memberInfo} onPress={() => router.push(`/user/${m.id}`)}>
                  <Avatar uri={m.avatar_url} name={m.name} size={44} />
                  <View style={{ flex: 1 }}>
                    <Body size={15} weight="medium" color={colors.onSurface} style={{ fontFamily: fonts.textMedium }}>{m.name}</Body>
                    {m.role !== "member" ? <Body size={12} color={colors.brandPrimary}>{m.role}</Body> : null}
                  </View>
                </Pressable>
                {circle.is_owner && m.role !== "owner" ? (
                  <Pressable
                    testID={`role-${m.id}`}
                    style={[styles.roleBtn, m.role === "moderator" && { backgroundColor: colors.brandPrimary }]}
                    onPress={() => toggleModerator(m)}
                  >
                    <Icon name="shield" size={16} color={m.role === "moderator" ? colors.onBrandPrimary : colors.brandPrimary} />
                  </Pressable>
                ) : null}
                <Pressable testID={`message-${m.id}`} style={styles.msgBtn} onPress={() => messageMember(m)}>
                  <Icon name="message-circle" size={18} color={colors.brandPrimary} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}
      </ScrollView>

      <EventComposer circleId={id!} visible={eventModal} onClose={() => setEventModal(false)} />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { height: 240, width: "100%" },
  heroImg: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
  heroScrim: { position: "absolute", left: 0, right: 0, bottom: 0, top: 0 },
  back: {
    position: "absolute",
    left: spacing.lg,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "rgba(0,0,0,0.3)",
    alignItems: "center",
    justifyContent: "center",
  },
  heroContent: { position: "absolute", left: spacing.lg, right: spacing.lg, bottom: spacing.lg, gap: 4 },
  metaRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginTop: spacing.xs },
  actions: { flexDirection: "row", gap: spacing.sm, padding: spacing.lg },
  tabs: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: colors.divider, paddingHorizontal: spacing.lg },
  tab: { paddingVertical: spacing.md, marginRight: spacing.xl, alignItems: "center" },
  tabUnderline: { position: "absolute", bottom: -1, height: 2, left: 0, right: 0, backgroundColor: colors.brandPrimary },
  eventCard: { backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.xs },
  eventFooter: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: spacing.sm },
  memberRow: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  memberInfo: { flexDirection: "row", alignItems: "center", gap: spacing.md, flex: 1 },
  msgBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: colors.brandTertiary, alignItems: "center", justifyContent: "center" },
  roleBtn: { width: 40, height: 40, borderRadius: 20, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  welcome: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    margin: spacing.lg,
    marginBottom: 0,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.brandTertiary,
  },
  welcomeInput: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: "top",
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
  },
  welcomeEdit: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
}));
