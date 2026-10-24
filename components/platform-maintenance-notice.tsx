import { View } from "react-native";
import { trpc } from "@/lib/trpc";
import { C, T } from "@/components/circles-ui";

/** Informational only: maintenance never unmounts navigation or a current live session. */
export function PlatformMaintenanceNotice() {
  const status = trpc.platform.status.useQuery(undefined, {
    staleTime: 0,
    refetchOnMount: "always",
    retry: false,
  });
  if (
    status.isError ||
    status.data?.integration !== "active" ||
    !status.data.feature_readiness ||
    !status.data.settings?.maintenanceMode
  ) {
    return null;
  }
  return (
    <View
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={{
        paddingHorizontal: 18,
        paddingVertical: 10,
        backgroundColor: C.soft,
        borderBottomWidth: 1,
        borderColor: C.border,
      }}
    >
      <T style={{ fontWeight: "700", fontSize: 14 }}>
        Circles is undergoing maintenance.
      </T>
      <T style={{ color: C.secondary, fontSize: 12 }}>
        Some features may be temporarily unavailable. Your current conversation
        stays open.
      </T>
    </View>
  );
}
