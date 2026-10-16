import { useMemo, useState } from "react";
import { FlatList, Pressable, ScrollView, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { apiPost, apiGet } from "@/src/api/client";
import { CircleCard, type Circle } from "@/src/components/circle-card";
import { Chip, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { useToast } from "@/src/components/toast";
import { usesNativeTabs } from "@/src/navigation";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";

const CATEGORIES = ["All", "Writing", "Wellness", "Photography", "Food", "Fitness", "Craft", "Music", "Books", "Travel", "Art", "Design", "Nature"];

export default function Explore() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const toast = useToast();
  const qc = useQueryClient();
  const bottomChrome = usesNativeTabs ? insets.bottom : 0;

  const [category, setCategory] = useState("All");
  const [search, setSearch] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["circles", category, search],
    queryFn: () =>
      apiGet<Circle[]>(
        `/api/circles?category=${encodeURIComponent(category)}&search=${encodeURIComponent(search)}`,
      ),
  });

  const toggleJoin = async (c: Circle) => {
    try {
      await apiPost(`/api/circles/${c.id}/${c.is_member ? "leave" : "join"}`, {});
      qc.invalidateQueries({ queryKey: ["circles"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      toast.show(c.is_member ? `Left ${c.name}` : `Joined ${c.name}`, "success");
    } catch {
      toast.show("Something went wrong", "error");
    }
  };

  const header = useMemo(
    () => (
      <>
        <View style={styles.searchWrap}>
          <Icon name="search" size={18} color={colors.muted} />
          <TextInput
            testID="circle-search"
            value={search}
            onChangeText={setSearch}
            placeholder="Search circles"
            placeholderTextColor={colors.muted}
            style={styles.searchInput}
          />
        </View>
        <View style={styles.chipScroller}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.chipRow}
          >
            {CATEGORIES.map((c) => (
              <Chip key={c} testID={`cat-${c}`} label={c} active={category === c} onPress={() => setCategory(c)} />
            ))}
          </ScrollView>
        </View>
      </>
    ),
    [search, category, colors, styles],
  );

  return (
    <View style={styles.root}>
      <ScreenHeader
        title="Discover"
        large
        right={
          <Pressable testID="create-circle" onPress={() => router.push("/circle/create")} hitSlop={8}>
            <Icon name="plus-circle" size={24} color={colors.brandPrimary} />
          </Pressable>
        }
      />
      {header}
      {isLoading ? (
        <Loading />
      ) : (
        <FlatList
          data={data ?? []}
          keyExtractor={(c) => c.id}
          renderItem={({ item }) => <CircleCard circle={item} onToggleJoin={toggleJoin} />}
          contentContainerStyle={{ paddingHorizontal: spacing.lg, paddingTop: spacing.md, paddingBottom: bottomChrome + spacing["3xl"] }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={
            <View style={{ marginTop: spacing["2xl"] }}>
              <EmptyState icon="compass" title="No circles found" message="Try a different search or category." />
            </View>
          }
        />
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  searchWrap: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.lg,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceSecondary,
  },
  searchInput: { flex: 1, fontFamily: fonts.textRegular, fontSize: 15, color: colors.onSurface },
  chipScroller: { height: 60, flexGrow: 0, flexShrink: 0 },
  chipRow: { gap: spacing.sm, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, alignItems: "center" },
}));
