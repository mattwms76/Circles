import { useState } from "react";
import { Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { apiPost, API_URL, getToken, mediaUrl } from "@/src/api/client";
import { uploadForm } from "@/src/utils/upload";
import { Body, Button } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const CATEGORIES = ["Writing", "Wellness", "Photography", "Food", "Fitness", "Craft", "Music", "Books", "Travel", "Art", "Design", "Nature", "General"];

export default function CreateCircle() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("General");
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const pickCover = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) Linking.openSettings().catch(() => {});
      toast.show("Photo access is needed for a cover", "error");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, aspect: [16, 9] });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const token = await getToken();
      const res = await uploadForm(`${API_URL}/api/upload`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        files: { file: { uri: asset.uri, name: asset.fileName ?? "cover.jpg", mimeType: asset.mimeType } },
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setCoverUrl(data.url);
    } catch {
      toast.show("Upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!name.trim()) return toast.show("Give your circle a name", "error");
    setBusy(true);
    try {
      const circle = await apiPost<{ id: string }>("/api/circles", {
        name: name.trim(),
        description: description.trim(),
        category,
        cover_url: coverUrl,
      });
      qc.invalidateQueries({ queryKey: ["circles"] });
      toast.show("Circle created", "success");
      router.replace(`/circle/${circle.id}`);
    } catch {
      toast.show("Could not create circle", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="New Circle" showBack />
      <KeyboardAwareScrollView bottomOffset={24} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Pressable testID="cover-pick" style={styles.cover} onPress={pickCover} disabled={uploading}>
          {coverUrl ? (
            <Image source={{ uri: mediaUrl(coverUrl) }} style={styles.coverImg} contentFit="cover" />
          ) : (
            <View style={styles.coverPlaceholder}>
              <Icon name="image" size={28} color={colors.muted} />
              <Body size={13} color={colors.muted}>{uploading ? "Uploading…" : "Add a cover photo"}</Body>
            </View>
          )}
        </Pressable>

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>Name</Body>
        <TextInput testID="circle-name" value={name} onChangeText={setName} placeholder="e.g. Morning Pages" placeholderTextColor={colors.muted} style={styles.input} />

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>Description</Body>
        <TextInput testID="circle-desc" value={description} onChangeText={setDescription} placeholder="What's this circle about?" placeholderTextColor={colors.muted} style={[styles.input, { minHeight: 90, textAlignVertical: "top" }]} multiline />

        <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>Category</Body>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.catRow}>
          {CATEGORIES.map((c) => (
            <Pressable key={c} testID={`circle-cat-${c}`} onPress={() => setCategory(c)} style={[styles.catChip, { borderColor: category === c ? colors.brandPrimary : colors.border, backgroundColor: category === c ? colors.brandPrimary : colors.surface }]}>
              <Body size={13} weight="medium" color={category === c ? colors.onBrandPrimary : colors.onSurfaceSecondary}>{c}</Body>
            </Pressable>
          ))}
        </ScrollView>
      </KeyboardAwareScrollView>
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="circle-create-submit" label="Create circle" onPress={submit} loading={busy} disabled={uploading} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  content: { padding: spacing.lg, gap: spacing.sm },
  cover: { height: 160, borderRadius: radius.lg, overflow: "hidden", backgroundColor: colors.surfaceSecondary, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.md },
  coverImg: { width: "100%", height: "100%" },
  coverPlaceholder: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  label: { fontFamily: fonts.textMedium, marginTop: spacing.sm },
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
  catRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  catChip: { flexShrink: 0, height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
}));
