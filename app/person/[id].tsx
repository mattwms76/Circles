import { useLocalSearchParams, useRouter } from "expo-router";
import ProfileScreen from "@/components/profile-screen";

function positiveSafeInteger(
  value: string | string[] | undefined,
): number | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null;
  const parsed = Number(raw);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const personId = positiveSafeInteger(id);
  const onBack = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/discover");
  };
  if (!personId) return <ProfileScreen invalidPersonRoute onBack={onBack} />;
  return <ProfileScreen personId={personId} onBack={onBack} />;
}
