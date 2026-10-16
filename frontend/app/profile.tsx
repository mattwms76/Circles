import { useState } from "react";
import { Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { apiPut, API_URL, getToken } from "@/src/api/client";
import { uploadForm } from "@/src/utils/upload";
import { Avatar, Body, Button, Display, Divider } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon, IconName } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function Profile() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user, signOut, updateUser } = useAuth();
  const toast = useToast();

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user?.name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [busy, setBusy] = useState(false);

  const changePhoto = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) Linking.openSettings().catch(() => {});
      toast.show("Photo access is needed", "error");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.6, aspect: [1, 1], allowsEditing: true });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    try {
      const token = await getToken();
      const res = await uploadForm(`${API_URL}/api/upload`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        files: { file: { uri: asset.uri, name: asset.fileName ?? "avatar.jpg", mimeType: asset.mimeType } },
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      const updated = await apiPut<typeof user>("/api/users/me", { avatar_url: data.url });
      if (updated) updateUser(updated);
      toast.show("Photo updated", "success");
    } catch {
      toast.show("Could not update photo", "error");
    }
  };

  const save = async () => {
    setBusy(true);
    try {
      const updated = await apiPut<typeof user>("/api/users/me", { name: name.trim(), bio: bio.trim() });
      if (updated) updateUser(updated);
      setEditing(false);
      toast.show("Profile saved", "success");
    } catch {
      toast.show("Could not save", "error");
    } finally {
      setBusy(false);
    }
  };

  const rows: { icon: IconName; label: string; onPress: () => void; testID: string }[] = [
    { icon: "credit-card", label: `Wallet · ${user?.coins ?? 0} coins`, onPress: () => router.push("/wallet"), testID: "row-wallet" },
    { icon: "grid", label: "My circles", onPress: () => router.push("/(tabs)/explore"), testID: "row-circles" },
  ];
  if (user?.is_moderator) {
    rows.push({ icon: "shield", label: "Moderation queue", onPress: () => router.push("/moderation"), testID: "row-moderation" });
  }

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="You"
        showBack
        right={
          <Pressable testID="edit-toggle" onPress={() => (editing ? save() : setEditing(true))} hitSlop={8}>
            <Body size={14} weight="medium" color={colors.brandPrimary}>
              {editing ? (busy ? "Saving…" : "Save") : "Edit"}
            </Body>
          </Pressable>
        }
      />
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <Pressable testID="change-photo" onPress={changePhoto}>
            <Avatar uri={user?.avatar_url} name={user?.name} size={96} />
            <View style={styles.camBadge}>
              <Icon name="camera" size={14} color={colors.onBrandPrimary} />
            </View>
          </Pressable>

          {editing ? (
            <View style={styles.editFields}>
              <TextInput testID="edit-name" value={name} onChangeText={setName} placeholder="Name" placeholderTextColor={colors.muted} style={styles.input} />
              <TextInput testID="edit-bio" value={bio} onChangeText={setBio} placeholder="Add a short bio" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 70, textAlignVertical: "top" }]} multiline />
            </View>
          ) : (
            <>
              <Display size={24} weight="semibold" style={{ marginTop: spacing.md }}>{user?.name}</Display>
              <Body size={14} color={colors.muted}>{user?.email}</Body>
              {user?.bio ? <Body size={14} color={colors.onSurfaceSecondary} style={{ textAlign: "center", marginTop: spacing.sm, paddingHorizontal: spacing.xl }}>{user.bio}</Body> : null}
            </>
          )}
        </View>

        {!editing ? (
          <>
            <Divider />
            <View style={styles.rows}>
              {rows.map((r) => (
                <Pressable key={r.label} testID={r.testID} style={styles.row} onPress={r.onPress}>
                  <Icon name={r.icon} size={20} color={colors.onSurfaceSecondary} />
                  <Body size={15} color={colors.onSurface} style={{ flex: 1 }}>{r.label}</Body>
                  <Icon name="chevron-right" size={20} color={colors.muted} />
                </Pressable>
              ))}
            </View>
            <View style={{ padding: spacing.lg }}>
              <Button testID="sign-out" label="Sign out" variant="ghost" icon="log-out" onPress={async () => { await signOut(); router.replace("/login"); }} />
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  hero: { alignItems: "center", paddingVertical: spacing.xl },
  camBadge: {
    position: "absolute",
    bottom: 0,
    right: 0,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.brandPrimary,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: colors.surface,
  },
  editFields: { width: "100%", paddingHorizontal: spacing.lg, gap: spacing.sm, marginTop: spacing.lg },
  input: {
    backgroundColor: colors.surfaceSecondary,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    fontFamily: fonts.textRegular,
    fontSize: 15,
    color: colors.onSurface,
    minHeight: 48,
  },
  rows: { paddingVertical: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
}));
