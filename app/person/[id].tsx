import React from "react";
import { useLocalSearchParams } from "expo-router";
import ProfileScreen from "@/components/profile-screen";
export default function PersonScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <ProfileScreen personId={Number(id)} />;
}
