import { useEffect } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";

import { useAuth } from "@/src/auth/auth-context";
import { Loading } from "@/src/components/ui";
import { makeStyles } from "@/src/theme";

export default function Index() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const styles = useStyles();

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace("/login");
    else if (!user.onboarded) router.replace("/onboarding");
    else router.replace("/(tabs)");
  }, [user, loading, router]);

  return (
    <View style={styles.container}>
      <Loading />
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  container: { flex: 1, backgroundColor: colors.surface },
}));
