import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiGet, apiPost } from "@/src/api/client";
import { Avatar, Body, Button, EmptyState, Loading } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { useToast } from "@/src/components/toast";
import { makeStyles, spacing, useTheme } from "@/src/theme";

type Blocked = { id: string; name: string; avatar_url: string | null };

export default function BlockedAccounts() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({ queryKey: ["blocks"], queryFn: () => apiGet<Blocked[]>("/api/users/me/blocks") });

  const unblock = async (id: string, name: string) => {
    try {
      await apiPost(`/api/users/${id}/unblock`, {});
      qc.invalidateQueries({ queryKey: ["blocks"] });
      qc.invalidateQueries({ queryKey: ["feed"] });
      toast.show(`Unblocked ${name}`, "success");
    } catch {
      toast.show("Could not unblock", "error");
    }
  };

  return (
    <View style={styles.root}>
      <ScreenHeader title="Blocked accounts" showBack />
      {isLoading ? (
        <Loading />
      ) : (data ?? []).length === 0 ? (
        <EmptyState icon="slash" title="No blocked accounts" message="People you block won't be able to message you or appear in your feed." />
      ) : (
        <ScrollView contentContainerStyle={{ padding: spacing.lg, paddingBottom: insets.bottom + spacing["2xl"], gap: spacing.md }}>
          {(data ?? []).map((b) => (
            <View key={b.id} style={styles.row} testID={`blocked-${b.id}`}>
              <Avatar uri={b.avatar_url} name={b.name} size={40} />
              <Body size={15} color={colors.onSurface} style={{ flex: 1 }}>{b.name}</Body>
              <Button small variant="secondary" label="Unblock" testID={`unblock-${b.id}`} onPress={() => unblock(b.id, b.name)} />
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.md },
}));
