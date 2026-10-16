import { useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";

import { apiGet } from "@/src/api/client";
import { storage } from "@/src/utils/storage";
import { useToast } from "@/src/components/toast";

type Reminder = { id: string; title: string; starts_at: string; circle_name: string };

const NUDGED_KEY = "nudged_events";

// Watches RSVP'd events and gently toasts when one starts within the hour.
export function NudgeWatcher() {
  const toast = useToast();
  const shown = useRef<Set<string>>(new Set());
  const loaded = useRef(false);

  const { data } = useQuery({
    queryKey: ["reminders"],
    queryFn: () => apiGet<Reminder[]>("/api/reminders"),
    refetchInterval: 60000,
  });

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    storage.getItem<string>(NUDGED_KEY, "").then((raw) => {
      (raw ?? "").split(",").filter(Boolean).forEach((i) => shown.current.add(i));
    });
  }, []);

  useEffect(() => {
    if (!data) return;
    const now = Date.now();
    const soon = data.filter((r) => {
      const t = new Date(r.starts_at).getTime();
      return t - now <= 60 * 60 * 1000 && t - now > -5 * 60 * 1000;
    });
    for (const r of soon) {
      if (shown.current.has(r.id)) continue;
      shown.current.add(r.id);
      toast.show(`Starting soon · ${r.title} in ${r.circle_name}`, "info");
      storage.setItem(NUDGED_KEY, Array.from(shown.current).join(","));
    }
  }, [data, toast]);

  return null;
}
