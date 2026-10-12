import { signedMediaUrls } from "./media";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import { clearAccountDrafts } from "./drafts";
import { requireSupabase, supabase } from "./supabase";
import { toProfile, loadCircles } from "./repositories";
import type { Circle, Profile, UUID } from "../types";

export interface NotificationSettings {
  push_enabled: boolean;
  messages: boolean;
  replies: boolean;
  memberships: boolean;
  live: boolean;
  events: boolean;
  quiet_enabled: boolean;
  quiet_start: string;
  quiet_end: string;
  timezone: string;
  diagnostics_enabled: boolean;
}
export const defaultNotificationSettings: NotificationSettings = {
  push_enabled: false,
  messages: true,
  replies: true,
  memberships: true,
  live: true,
  events: true,
  quiet_enabled: false,
  quiet_start: "22:00",
  quiet_end: "08:00",
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
  diagnostics_enabled: false,
};
export interface ActivityNotification {
  id: string;
  kind: string;
  title: string;
  body: string;
  target_id: string;
  circle_id: string | null;
  read_at: string | null;
  created_at: string;
}
export interface CircleEvent {
  id: string;
  circle_id: string;
  title: string;
  description: string;
  starts_at: string;
  attending: boolean;
}
export interface ModerationReport {
  id: string;
  target_type: string;
  target_id: string;
  reason: string;
  content: string | null;
  created_at: string;
  media?: { kind: string; path: string; url?: string }[];
}
async function userId() {
  const { data, error } = await requireSupabase().auth.getUser();
  if (error || !data.user) throw new Error("Sign in to continue.");
  return data.user.id;
}
function checked<T>(result: { data: T; error: any }): T {
  if (result.error) throw result.error;
  return result.data;
}

export async function searchDiscovery(
  query: string,
  interest: string,
  circleOffset = 0,
  peopleOffset = 0,
) {
  if (!supabase) {
    const circles = (await loadCircles(0, 100)).filter(
      (c) =>
        `${c.name} ${c.description} ${c.interest}`
          .toLowerCase()
          .includes(query.toLowerCase()) &&
        (["All", "For you"].includes(interest) || c.interest === interest),
    );
    return {
      circles: circles.slice(circleOffset, circleOffset + 30),
      people: [] as Profile[],
    };
  }
  const id = await userId();
  const [circleResult, peopleResult, membershipResult] = await Promise.all([
    supabase.rpc("search_circles", {
      search_text: query,
      interest_filter: interest,
      page_offset: circleOffset,
      page_size: 30,
    }),
    supabase.rpc("search_people", {
      search_text: query,
      page_offset: peopleOffset,
      page_size: 20,
    }),
    supabase
      .from("circle_memberships")
      .select("circle_id,status,role")
      .eq("user_id", id),
  ]);
  const memberships = new Map(
    checked(membershipResult)
      ?.filter((m) => m.status === "member")
      .map((m) => [m.circle_id, m.role]),
  );
  return {
    circles: (checked(circleResult) ?? []).map(
      (c: any): Circle => ({
        id: c.id,
        name: c.name,
        description: c.description,
        interest: c.interest,
        members: c.members_count,
        isPrivate: c.is_private,
        isMember: memberships.has(c.id),
        isOwner: memberships.get(c.id) === "owner",
        color: c.cover_color,
        imageUrl: c.cover_url ?? "",
        welcomeText: c.welcome_text,
      }),
    ),
    people: (checked(peopleResult) ?? []).map(toProfile) as Profile[],
  };
}
export async function completeOnboarding(
  displayName: string,
  interests: string[],
  avatarUrl?: string,
) {
  const id = await userId();
  return toProfile(
    checked(
      await requireSupabase()
        .from("profiles")
        .update({
          display_name: displayName.trim(),
          interests,
          onboarding_completed_at: new Date().toISOString(),
          ...(avatarUrl ? { avatar_url: avatarUrl } : {}),
        })
        .eq("id", id)
        .select("*")
        .single(),
    ),
  );
}
export async function uploadAvatar(uri: string, mimeType: string, expectedUserId?: string) {
  const id = await userId();
  if (expectedUserId && id !== expectedUserId) throw new Error("Your account changed. Please try again.");
  const extension = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as Record<string, string>)[mimeType];
  if (!extension) throw new Error("Choose a JPG, PNG, or WebP photo.");
  const path = `${id}/${Date.now()}.${extension}`;
  const bytes = await (await fetch(uri)).arrayBuffer();
  if (bytes.byteLength > 5 * 1024 * 1024)
    throw new Error("Choose a profile photo smaller than 5 MB.");
  checked(
    await requireSupabase()
      .storage.from("avatars")
      .upload(path, bytes, { contentType: mimeType }),
  );
  return requireSupabase().storage.from("avatars").getPublicUrl(path).data
    .publicUrl;
}
export async function getNotificationSettings(): Promise<NotificationSettings> {
  if (!supabase) return defaultNotificationSettings;
  const data = checked(
    await supabase
      .from("notification_preferences")
      .select("*")
      .eq("user_id", await userId())
      .maybeSingle(),
  );
  return { ...defaultNotificationSettings, ...data };
}
export async function saveNotificationSettings(settings: NotificationSettings) {
  checked(
    await requireSupabase()
      .from("notification_preferences")
      .upsert({ ...settings, user_id: await userId() }),
  );
}
export async function enableDevicePush() {
  const projectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId)
    throw new Error(
      "Device notifications are not available in this build yet. Your activity inbox will still work.",
    );
  if (Platform.OS === "android")
    await Notifications.setNotificationChannelAsync("circles", {
      name: "Circles activity",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  const permission = await Notifications.requestPermissionsAsync();
  if (permission.status !== "granted")
    throw new Error(
      "Notifications are disabled. You can allow them in your device settings.",
    );
  const { data: token } = await Notifications.getExpoPushTokenAsync({
    projectId,
  });
  checked(
    await requireSupabase().rpc("register_push_token", { push_token: token }),
  );
  await AsyncStorage.setItem("circles:device-push-token", token);
  return token;
}
export async function loadNotifications(
  offset = 0,
): Promise<ActivityNotification[]> {
  if (!supabase) return [];
  return (
    checked(
      await supabase
        .from("notifications")
        .select("id,kind,title,body,target_id,circle_id,read_at,created_at")
        .order("created_at", { ascending: false })
        .order("id")
        .range(offset, offset + 29),
    ) ?? []
  );
}
export async function markNotificationRead(id: string) {
  checked(
    await requireSupabase()
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", id),
  );
}
export async function loadBlockedPeople(): Promise<Profile[]> {
  if (!supabase) return [];
  const data = checked(
    await supabase
      .from("blocks")
      .select(
        "blocked:profiles!blocks_blocked_id_fkey(id,handle,display_name,avatar_url,bio,interests)",
      )
      .eq("blocker_id", await userId()),
  );
  return (data ?? []).map((r: any) => toProfile(r.blocked));
}
export async function unblockPerson(id: string) {
  checked(
    await requireSupabase()
      .from("blocks")
      .delete()
      .eq("blocker_id", await userId())
      .eq("blocked_id", id),
  );
}
export async function circleNotificationsEnabled(circleId: string) {
  if (!supabase) return true;
  const result = checked(
    await supabase
      .from("circle_notification_preferences")
      .select("enabled")
      .eq("user_id", await userId())
      .eq("circle_id", circleId)
      .maybeSingle(),
  );
  return result?.enabled ?? true;
}
export async function setCircleNotifications(
  circleId: string,
  enabled: boolean,
) {
  checked(
    await requireSupabase()
      .from("circle_notification_preferences")
      .upsert({ user_id: await userId(), circle_id: circleId, enabled }),
  );
}
export async function loadEvents(circleId: string): Promise<CircleEvent[]> {
  if (!supabase) return [];
  const [events, rsvps] = await Promise.all([
    supabase
      .from("circle_events")
      .select("*")
      .eq("circle_id", circleId)
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(30),
    supabase
      .from("event_rsvps")
      .select("event_id")
      .eq("user_id", await userId()),
  ]);
  const attending = new Set(checked(rsvps)?.map((r) => r.event_id));
  return (checked(events) ?? []).map((e) => ({
    ...e,
    attending: attending.has(e.id),
  }));
}
export async function scheduleEvent(
  circleId: string,
  title: string,
  description: string,
  startsAt: string,
) {
  if (
    !Number.isFinite(Date.parse(startsAt)) ||
    Date.parse(startsAt) <= Date.now()
  )
    throw new Error("Choose a future date and time.");
  checked(
    await requireSupabase()
      .from("circle_events")
      .insert({
        circle_id: circleId,
        creator_id: await userId(),
        title: title.trim(),
        description: description.trim(),
        starts_at: new Date(startsAt).toISOString(),
      }),
  );
}
export async function cancelEvent(eventId: string) {
  checked(
    await requireSupabase().from("circle_events").delete().eq("id", eventId),
  );
}
export async function rsvpEvent(event: CircleEvent) {
  const query = requireSupabase().from("event_rsvps");
  const id = await userId();
  checked(
    event.attending
      ? await query.delete().eq("event_id", event.id).eq("user_id", id)
      : await query.insert({ event_id: event.id, user_id: id }),
  );
}
export async function saveWelcome(circleId: string, welcome: string) {
  checked(
    await requireSupabase()
      .from("circles")
      .update({ welcome_text: welcome.trim() })
      .eq("id", circleId),
  );
}
export async function loadWelcome(circleId: string) {
  if (!supabase) return "";
  return (
    checked(
      await supabase
        .from("circles")
        .select("welcome_text")
        .eq("id", circleId)
        .single(),
    )?.welcome_text ?? ""
  );
}
export async function isModerator() {
  if (!supabase) return false;
  return Boolean(
    checked(
      await supabase
        .from("moderators")
        .select("user_id")
        .eq("user_id", await userId())
        .maybeSingle(),
    ),
  );
}
export async function loadModerationQueue(): Promise<ModerationReport[]> {
  const reports: ModerationReport[] =
    checked(await requireSupabase().rpc("moderation_queue")) ?? [];
  const urls = await signedMediaUrls(
    reports.flatMap((r) => r.media?.map((m) => m.path) ?? []),
    await userId(),
  );
  return reports.map((r) => ({
    ...r,
    media: r.media?.map((m) => ({ ...m, url: urls.get(m.path) })),
  }));
}
export async function reviewReport(
  reportId: string,
  decision: "remove" | "resolve" | "dismiss",
  note: string,
) {
  checked(
    await requireSupabase().rpc("review_report", {
      report_id: reportId,
      decision,
      note,
    }),
  );
}
export async function loadActivationMetrics(): Promise<Record<string, number>> {
  return checked(await requireSupabase().rpc("activation_metrics")) ?? {};
}
export async function releaseLiveSeat(id: UUID) {
  if (supabase)
    checked(await supabase.rpc("leave_live_seat", { target_session_id: id }));
}
export async function beatLiveSeat(id: UUID) {
  if (supabase)
    checked(
      await supabase.rpc("heartbeat_live_seat", { target_session_id: id }),
    );
}
export async function requestPasswordReset(email: string) {
  checked(
    await requireSupabase().auth.resetPasswordForEmail(email.trim(), {
      redirectTo: "circles://auth/recovery",
    }),
  );
}
export async function setNewPassword(password: string) {
  if (password.length < 8) throw new Error("Use at least 8 characters.");
  const result = await requireSupabase().auth.updateUser({ password });
  if (result.error) throw result.error;
}
export async function deleteAccount(password: string) {
  const client = requireSupabase();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user?.email)
    throw new Error("Sign in again before deleting your account.");
  const authenticated = await client.auth.signInWithPassword({
    email: user.email,
    password,
  });
  if (authenticated.error) throw authenticated.error;
  const result = await client.functions.invoke("delete-account", {
    body: { confirmation: "DELETE" },
  });
  if (result.error)
    throw new Error(
      "Your account could not be deleted. Please sign in again and retry.",
    );
  if (!result.data?.deleted)
    throw new Error("Deletion is not confirmed. Please retry.");
  try {
    await clearAccountDrafts(user.id);
  } finally {
    await client.auth.signOut({ scope: "local" });
  }
}

export async function signOutDevice() {
  if (!supabase) return;
  const token = await AsyncStorage.getItem("circles:device-push-token");
  if (token) {
    const result = await supabase
      .from("device_push_tokens")
      .delete()
      .eq("token", token);
    if (result.error) throw result.error;
    await AsyncStorage.removeItem("circles:device-push-token");
  }
  const result = await supabase.auth.signOut();
  if (result.error) throw result.error;
}
