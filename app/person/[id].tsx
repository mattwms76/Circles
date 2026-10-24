import { useLocalSearchParams } from "expo-router";
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
  const personId = positiveSafeInteger(id);
  if (!personId) return <ProfileScreen invalidPersonRoute />;
  return <ProfileScreen personId={personId} />;
}
