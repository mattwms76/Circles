import { useState } from "react";
import { Linking, Pressable, ScrollView, TextInput, View } from "react-native";
import { Image } from "expo-image";
import * as ImagePicker from "expo-image-picker";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { KeyboardAwareScrollView } from "react-native-keyboard-controller";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { apiGet, apiPost, API_URL, getToken, mediaUrl } from "@/src/api/client";
import { uploadForm } from "@/src/utils/upload";
import type { Circle } from "@/src/components/circle-card";
import { Body, Button, Display, Loading } from "@/src/components/ui";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

export default function CreatePost() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();

  const [circleId, setCircleId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const { data: circles, isLoading } = useQuery({
    queryKey: ["circles", "mine"],
    queryFn: () => apiGet<Circle[]>("/api/circles?mine=true"),
  });

  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      if (!perm.canAskAgain) {
        toast.show("Enable photo access in Settings", "error");
        Linking.openSettings().catch(() => {});
      } else {
        toast.show("Photo access is needed to add an image", "error");
      }
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 0.7,
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setUploading(true);
    try {
      const token = await getToken();
      const res = await uploadForm(`${API_URL}/api/upload`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        files: { file: { uri: asset.uri, name: asset.fileName ?? "photo.jpg", mimeType: asset.mimeType } },
      });
      const data = await res.json();
      if (!res.ok) throw new Error();
      setImageUrl(data.url);
    } catch {
      toast.show("Image upload failed", "error");
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    if (!circleId) return toast.show("Pick a circle to post in", "error");
    if (!text.trim() && !imageUrl) return toast.show("Write something or add a photo", "error");
    setBusy(true);
    try {
      await apiPost("/api/posts", { circle_id: circleId, text: text.trim(), image_url: imageUrl });
      qc.invalidateQueries({ queryKey: ["feed"] });
      qc.invalidateQueries({ queryKey: ["circle-posts", circleId] });
      toast.show("Posted", "success");
      router.back();
    } catch {
      toast.show("Could not publish", "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top + spacing.sm }]}>
      <View style={styles.header}>
        <Pressable testID="composer-close" onPress={() => router.back()} hitSlop={8}>
          <Icon name="x" size={24} color={colors.onSurface} />
        </Pressable>
        <Display size={18} weight="medium">New Post</Display>
        <View style={{ width: 24 }} />
      </View>

      {isLoading ? (
        <Loading />
      ) : (
        <KeyboardAwareScrollView bottomOffset={16} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <Body size={12} weight="medium" color={colors.onSurfaceSecondary} style={styles.label}>
            Post to
          </Body>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.circleRow}>
            {(circles ?? []).length === 0 ? (
              <Body size={13} color={colors.muted}>Join a circle first to post.</Body>
            ) : (
              (circles ?? []).map((c) => (
                <Pressable
                  key={c.id}
                  testID={`post-to-${c.id}`}
                  onPress={() => setCircleId(c.id)}
                  style={[styles.circleChip, { borderColor: circleId === c.id ? colors.brandPrimary : colors.border, backgroundColor: circleId === c.id ? colors.brandTertiary : colors.surface }]}
                >
                  <Body size={13} weight="medium" color={circleId === c.id ? colors.onBrandTertiary : colors.onSurfaceSecondary} style={{ fontFamily: fonts.textMedium }}>
                    {c.name}
                  </Body>
                </Pressable>
              ))
            )}
          </ScrollView>

          <TextInput
            testID="composer-text"
            value={text}
            onChangeText={setText}
            placeholder="Share a thought with your circle…"
            placeholderTextColor={colors.muted}
            multiline
            style={styles.textArea}
          />

          {imageUrl ? (
            <View style={styles.previewWrap}>
              <Image source={{ uri: mediaUrl(imageUrl) }} style={styles.preview} contentFit="cover" />
              <Pressable testID="remove-image" style={styles.removeImg} onPress={() => setImageUrl(null)}>
                <Icon name="x" size={16} color={colors.onSurfaceInverse} />
              </Pressable>
            </View>
          ) : null}

          <Pressable testID="add-photo" style={styles.addPhoto} onPress={pickImage} disabled={uploading}>
            <Icon name="image" size={20} color={colors.brandPrimary} />
            <Body size={14} weight="medium" color={colors.brandPrimary} style={{ fontFamily: fonts.textMedium }}>
              {uploading ? "Uploading…" : imageUrl ? "Replace photo" : "Add photo"}
            </Body>
          </Pressable>
        </KeyboardAwareScrollView>
      )}

      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button testID="composer-publish" label="Publish" onPress={submit} loading={busy} disabled={uploading} />
      </View>
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  content: { padding: spacing.lg, gap: spacing.md },
  label: { fontFamily: fonts.textMedium },
  circleRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  circleChip: { flexShrink: 0, height: 36, paddingHorizontal: spacing.lg, borderRadius: radius.pill, borderWidth: 1, alignItems: "center", justifyContent: "center" },
  textArea: {
    minHeight: 140,
    backgroundColor: colors.surface,
    fontFamily: fonts.displayRegular,
    fontSize: 18,
    lineHeight: 26,
    color: colors.onSurface,
    textAlignVertical: "top",
    marginTop: spacing.sm,
  },
  previewWrap: { position: "relative" },
  preview: { width: "100%", aspectRatio: 4 / 3, borderRadius: radius.md, backgroundColor: colors.surfaceTertiary },
  removeImg: {
    position: "absolute",
    top: spacing.sm,
    right: spacing.sm,
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.surfaceInverse,
    alignItems: "center",
    justifyContent: "center",
  },
  addPhoto: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingVertical: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.md, borderTopWidth: 1, borderTopColor: colors.divider },
}));
