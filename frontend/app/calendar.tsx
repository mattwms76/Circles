import { useMemo, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";

import { apiGet, apiPost } from "@/src/api/client";
import { Body, Button, Display, EmptyState, Loading, Overline } from "@/src/components/ui";
import { ScreenHeader } from "@/src/components/header";
import { Icon } from "@/src/components/icon";
import { fonts, makeStyles, radius, spacing, useTheme } from "@/src/theme";
import { formatDateTime } from "@/src/lib/time";

type CalEvent = {
  id: string;
  title: string;
  starts_at: string;
  circle_id: string;
  circle_name: string;
  rsvp_count: number;
  going: boolean;
};

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

function dayKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default function Calendar() {
  const styles = useStyles();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const qc = useQueryClient();

  const [cursor, setCursor] = useState(() => new Date());
  const [selected, setSelected] = useState(() => dayKey(new Date()));

  const { data, isLoading } = useQuery({
    queryKey: ["events-upcoming"],
    queryFn: () => apiGet<CalEvent[]>("/api/events/upcoming"),
  });

  const byDay = useMemo(() => {
    const map: Record<string, CalEvent[]> = {};
    (data ?? []).forEach((e) => {
      const k = dayKey(new Date(e.starts_at));
      (map[k] = map[k] || []).push(e);
    });
    return map;
  }, [data]);

  const grid = useMemo(() => {
    const year = cursor.getFullYear();
    const month = cursor.getMonth();
    const first = new Date(year, month, 1).getDay();
    const days = new Date(year, month + 1, 0).getDate();
    const cells: (Date | null)[] = [];
    for (let i = 0; i < first; i++) cells.push(null);
    for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }, [cursor]);

  const selectedEvents = byDay[selected] ?? [];

  const rsvp = async (ev: CalEvent) => {
    qc.setQueryData<CalEvent[]>(["events-upcoming"], (old) =>
      (old ?? []).map((e) => (e.id === ev.id ? { ...e, going: !e.going, rsvp_count: e.rsvp_count + (e.going ? -1 : 1) } : e)),
    );
    await apiPost(`/api/events/${ev.id}/rsvp`, {}).catch(() => {});
  };

  const shift = (n: number) => setCursor((c) => new Date(c.getFullYear(), c.getMonth() + n, 1));

  return (
    <View style={styles.root}>
      <ScreenHeader title="Calendar" showBack />
      {isLoading ? (
        <Loading />
      ) : (
        <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + spacing["2xl"] }} showsVerticalScrollIndicator={false}>
          <View style={styles.monthHeader}>
            <Pressable testID="cal-prev" onPress={() => shift(-1)} hitSlop={8} style={styles.navBtn}>
              <Icon name="chevron-left" size={22} color={colors.onSurface} />
            </Pressable>
            <Display size={20} weight="medium">{MONTHS[cursor.getMonth()]} {cursor.getFullYear()}</Display>
            <Pressable testID="cal-next" onPress={() => shift(1)} hitSlop={8} style={styles.navBtn}>
              <Icon name="chevron-right" size={22} color={colors.onSurface} />
            </Pressable>
          </View>

          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <View key={i} style={styles.cell}><Body size={12} color={colors.muted}>{w}</Body></View>
            ))}
          </View>

          <View style={styles.monthGrid}>
            {grid.map((d, i) => {
              if (!d) return <View key={i} style={styles.cell} />;
              const k = dayKey(d);
              const has = (byDay[k]?.length ?? 0) > 0;
              const isSel = k === selected;
              const isToday = k === dayKey(new Date());
              return (
                <Pressable key={i} testID={`cal-day-${d.getDate()}`} style={styles.cell} onPress={() => setSelected(k)}>
                  <View style={[styles.dayCircle, isSel && { backgroundColor: colors.brandPrimary }, !isSel && isToday && { borderWidth: 1, borderColor: colors.brandPrimary }]}>
                    <Body size={14} weight={isSel ? "medium" : "regular"} color={isSel ? colors.onBrandPrimary : colors.onSurface} style={{ fontFamily: isSel ? fonts.textMedium : fonts.textRegular }}>
                      {d.getDate()}
                    </Body>
                  </View>
                  {has ? <View style={[styles.dot, { backgroundColor: isSel ? colors.brandPrimary : colors.brandSecondary }]} /> : <View style={styles.dot} />}
                </Pressable>
              );
            })}
          </View>

          <View style={styles.list}>
            <Overline>Events</Overline>
            {selectedEvents.length === 0 ? (
              <View style={{ marginTop: spacing.lg }}>
                <EmptyState icon="calendar" title="No events this day" message="Pick another day or RSVP to events in your circles." />
              </View>
            ) : (
              selectedEvents.map((e) => (
                <View key={e.id} style={styles.eventCard} testID={`cal-event-${e.id}`}>
                  <Pressable style={{ flex: 1 }} onPress={() => router.push(`/circle/${e.circle_id}`)}>
                    <Overline>{formatDateTime(e.starts_at)}</Overline>
                    <Display size={16} weight="medium">{e.title}</Display>
                    <Body size={12} color={colors.muted}>{e.circle_name} · {e.rsvp_count} going</Body>
                  </Pressable>
                  <Button testID={`cal-rsvp-${e.id}`} small label={e.going ? "Going" : "RSVP"} icon={e.going ? "check" : "plus"} variant={e.going ? "secondary" : "primary"} onPress={() => rsvp(e)} />
                </View>
              ))
            )}
          </View>
        </ScrollView>
      )}
    </View>
  );
}

const useStyles = makeStyles((colors) => ({
  root: { flex: 1, backgroundColor: colors.surface },
  monthHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: spacing.lg },
  navBtn: { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: colors.surfaceSecondary },
  weekRow: { flexDirection: "row", paddingHorizontal: spacing.sm },
  monthGrid: { flexDirection: "row", flexWrap: "wrap", paddingHorizontal: spacing.sm },
  cell: { width: `${100 / 7}%`, alignItems: "center", justifyContent: "center", paddingVertical: spacing.xs },
  dayCircle: { width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center" },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2, backgroundColor: "transparent" },
  list: { padding: spacing.lg, gap: spacing.md },
  eventCard: { flexDirection: "row", alignItems: "center", gap: spacing.md, backgroundColor: colors.surfaceSecondary, borderRadius: radius.lg, padding: spacing.lg },
}));
