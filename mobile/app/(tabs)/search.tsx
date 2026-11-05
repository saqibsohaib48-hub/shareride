import { useEffect, useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import type { RideSummary } from '@share-ride/shared';
import { api } from '@/lib/api';
import { useApp } from '@/lib/app';
import { ErrorBox, RideRow, T, useColors } from '@/ui';

const SORTS = ['best', 'cheapest', 'earliest', 'closest', 'rating', 'shortest'] as const;

/** Search results (screen 9) with sorting. */
export default function Search() {
  const p = useLocalSearchParams<Record<string, string>>();
  const { t } = useApp();
  const c = useColors();
  const [sort, setSort] = useState<(typeof SORTS)[number]>('best');
  const [rides, setRides] = useState<RideSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!p.fa || !p.ta || !p.date) return;
    setRides(null); setError(null);
    const start = new Date(`${p.date}T00:00:00`), end = new Date(start.getTime() + 86400_000);
    api<RideSummary[]>('/rides/search', { query: { fromLat: p.fa, fromLng: p.fo, toLat: p.ta, toLng: p.to, departAfter: start.toISOString(), departBefore: end.toISOString(), seats: p.seats ?? 1, sort } })
      .then(setRides).catch(setError);
  }, [p.fa, p.fo, p.ta, p.to, p.date, p.seats, sort]);

  if (!p.fa) return <View style={{ flex: 1, padding: 24, backgroundColor: c.bg, gap: 12 }}><T variant="h2">{t('home.where')}</T><T variant="muted">Start a search from the Home tab.</T></View>;
  return (
    <View style={{ flex: 1, backgroundColor: c.bg }}>
      <View style={{ padding: 16, gap: 8 }}>
        <T variant="h2">{p.fn} → {p.tn}</T>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {SORTS.map((s) => (
            <Pressable key={s} accessibilityRole="tab" accessibilityState={{ selected: sort === s }} onPress={() => setSort(s)}
              style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, backgroundColor: sort === s ? c.ink : c.surface, borderWidth: 1.5, borderColor: sort === s ? c.ink : c.line }}>
              <Text style={{ color: sort === s ? c.bg : c.ink2, fontWeight: '600' }}>{t(`sort.${s}` as any)}</Text>
            </Pressable>
          ))}
        </ScrollView>
        <ErrorBox error={error} />
        {rides && <T variant="muted">{t('search.results', { count: rides.length })}</T>}
      </View>
      <FlatList
        data={rides ?? []} keyExtractor={(r) => r.id} contentContainerStyle={{ padding: 16, paddingTop: 0, gap: 12 }}
        ListEmptyComponent={rides ? <T variant="muted">{t('search.noResults')}</T> : <T variant="muted">{t('common.loading')}</T>}
        renderItem={({ item }) => <RideRow ride={item} onPress={() => router.push({ pathname: '/ride/[id]', params: { id: item.id, seats: p.seats ?? '1', pn: p.fn, pa: p.fa, po: p.fo, dn: p.tn, da: p.ta, do: p.to } })} />}
      />
    </View>
  );
}
