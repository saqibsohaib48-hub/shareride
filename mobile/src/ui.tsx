import { ReactNode, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, Pressable, StyleSheet, Text, TextInput, TextInputProps, View, ViewStyle, useColorScheme } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { decodePolyline, LatLng, RideSummary } from '@share-ride/shared';
import { api, ApiError } from './lib/api';
import { useApp } from './lib/app';

export const colors = {
  light: { bg: '#f7f5f0', surface: '#ffffff', surface2: '#f0ede6', ink: '#12211d', ink2: '#4a5a55', ink3: '#7b8985', line: '#e3dfd6', brand: '#0e7c66', brandSoft: '#dff1ec', accent: '#ff7a45', accentSoft: '#ffe9df', danger: '#c2362b', dangerSoft: '#fde8e6' },
  dark: { bg: '#0d1513', surface: '#142220', surface2: '#1b2c29', ink: '#e9f1ee', ink2: '#b2c2bd', ink3: '#82938e', line: '#263935', brand: '#2fb393', brandSoft: '#173a33', accent: '#ff8f61', accentSoft: '#3b2418', danger: '#ff6b5e', dangerSoft: '#3a1b18' },
};
export function useColors() { return colors[useColorScheme() === 'dark' ? 'dark' : 'light']; }

export function Screen({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  const { online, t } = useApp();
  return (
    <View style={[{ flex: 1, backgroundColor: c.bg }, style]}>
      {!online && <Text accessibilityRole="alert" style={{ backgroundColor: c.ink, color: c.bg, textAlign: 'center', padding: 6, fontWeight: '600' }}>{t('errors.offline')}</Text>}
      {children}
    </View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const c = useColors();
  return <View style={[{ backgroundColor: c.surface, borderColor: c.line, borderWidth: 1, borderRadius: 16, padding: 16, gap: 10 }, style]}>{children}</View>;
}

export function T({ children, style, variant = 'body' }: { children: ReactNode; style?: any; variant?: 'h1' | 'h2' | 'body' | 'muted' | 'small' | 'price' }) {
  const c = useColors();
  const v = { h1: { fontSize: 28, fontWeight: '800' as const, color: c.ink }, h2: { fontSize: 19, fontWeight: '700' as const, color: c.ink }, body: { fontSize: 16, color: c.ink }, muted: { fontSize: 15, color: c.ink2 }, small: { fontSize: 13, color: c.ink3 }, price: { fontSize: 22, fontWeight: '800' as const, color: c.ink } }[variant];
  return <Text style={[v, { writingDirection: 'auto' }, style]} maxFontSizeMultiplier={1.8}>{children}</Text>;
}

/** Large, accessible button (min 48dp). */
export function Button({ title, onPress, kind = 'primary', disabled, loading }: { title: string; onPress: () => void; kind?: 'primary' | 'accent' | 'outline' | 'danger'; disabled?: boolean; loading?: boolean }) {
  const c = useColors();
  const bg = { primary: c.brand, accent: c.accent, outline: 'transparent', danger: c.dangerSoft }[kind];
  const fg = { primary: '#fff', accent: '#2b1006', outline: c.ink, danger: c.danger }[kind];
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ disabled: !!disabled || !!loading }} disabled={disabled || loading} onPress={onPress}
      style={({ pressed }) => ({ minHeight: 50, borderRadius: 999, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20, backgroundColor: bg, borderWidth: kind === 'outline' ? 1.5 : 0, borderColor: c.line, opacity: disabled ? 0.5 : pressed ? 0.85 : 1 })}>
      {loading ? <ActivityIndicator color={fg} /> : <Text style={{ color: fg, fontWeight: '700', fontSize: 16 }}>{title}</Text>}
    </Pressable>
  );
}

export function Field({ label, error, ...props }: TextInputProps & { label: string; error?: string }) {
  const c = useColors();
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: '600', color: c.ink }}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={c.ink3} {...props}
        style={{ minHeight: 50, borderRadius: 10, borderWidth: 1.5, borderColor: error ? c.danger : c.line, paddingHorizontal: 14, color: c.ink, backgroundColor: c.surface, fontSize: 16, textAlign: 'auto' as any }} />
      {error ? <Text style={{ color: c.danger, fontSize: 13 }}>{error}</Text> : null}
    </View>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const c = useColors();
  const { t } = useApp();
  if (!error) return null;
  const e = error instanceof ApiError ? error : null;
  return (
    <View accessibilityRole="alert" style={{ backgroundColor: c.dangerSoft, borderRadius: 10, padding: 12 }}>
      <Text style={{ color: c.danger }}>{e?.message ?? t('errors.generic')}</Text>
      {Array.isArray(e?.details) && (e!.details as string[]).map((d) => <Text key={d} style={{ color: c.danger }}>• {d}</Text>)}
      {e?.referenceId ? <Text style={{ color: c.danger, fontSize: 12 }}>{t('errors.reference', { id: e.referenceId })}</Text> : null}
    </View>
  );
}

export function Pill({ text, tone = 'default' }: { text: string; tone?: 'default' | 'brand' | 'accent' | 'danger' }) {
  const c = useColors();
  const bg = { default: c.surface2, brand: c.brandSoft, accent: c.accentSoft, danger: c.dangerSoft }[tone];
  const fg = { default: c.ink2, brand: c.brand, accent: c.ink, danger: c.danger }[tone];
  return <Text style={{ backgroundColor: bg, color: fg, paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999, fontSize: 12, fontWeight: '600', overflow: 'hidden' }}>{text}</Text>;
}

export interface Place { name: string; lat: number; lng: number }

/** Place picker: tap → full-screen search (maps provider via API). */
export function PlacePicker({ label, value, onChange }: { label: string; value: Place | null; onChange: (p: Place) => void }) {
  const c = useColors();
  const { country } = useApp();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [items, setItems] = useState<Place[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => {
    clearTimeout(timer.current);
    if (q.trim().length < 2) return setItems([]);
    timer.current = setTimeout(() => api<Place[]>('/routes/places', { query: { q, country: country?.code } }).then(setItems).catch(() => setItems([])), 250);
  }, [q, country?.code]);
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontWeight: '600', color: c.ink }}>{label}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}: ${value?.name ?? 'not set'}`} onPress={() => setOpen(true)}
        style={{ minHeight: 50, borderRadius: 10, borderWidth: 1.5, borderColor: c.line, paddingHorizontal: 14, justifyContent: 'center', backgroundColor: c.surface }}>
        <Text style={{ color: value ? c.ink : c.ink3, fontSize: 16 }}>{value?.name ?? 'Search a place'}</Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={{ flex: 1, padding: 16, paddingTop: 56, gap: 12, backgroundColor: c.bg }}>
          <Field label={label} autoFocus value={q} onChangeText={setQ} placeholder="e.g. Dubai Marina" />
          <FlatList data={items} keyExtractor={(p, i) => `${p.name}${i}`} renderItem={({ item }) => (
            <Pressable accessibilityRole="button" onPress={() => { onChange(item); setOpen(false); setQ(''); }} style={{ paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth, borderColor: c.line }}>
              <Text style={{ color: c.ink, fontSize: 16 }}>📍 {item.name}</Text>
            </Pressable>
          )} />
          <Button title="Close" kind="outline" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

/** Route map: pickup (brand) and destination (accent) pins with the road polyline. */
export function RouteMapView({ polyline, origin, destination, height = 200 }: { polyline?: string | null; origin: LatLng; destination: LatLng; height?: number }) {
  const pts = polyline ? decodePolyline(polyline) : [origin, destination];
  const coords = pts.map((p) => ({ latitude: p.lat, longitude: p.lng }));
  const lats = coords.map((p) => p.latitude), lngs = coords.map((p) => p.longitude);
  const region = { latitude: (Math.min(...lats) + Math.max(...lats)) / 2, longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2, latitudeDelta: (Math.max(...lats) - Math.min(...lats)) * 1.5 + 0.02, longitudeDelta: (Math.max(...lngs) - Math.min(...lngs)) * 1.5 + 0.02 };
  return (
    <MapView provider={PROVIDER_GOOGLE} style={{ height, borderRadius: 16 }} initialRegion={region} accessibilityLabel="Route map" pointerEvents="none">
      <Polyline coordinates={coords} strokeColor="#0e7c66" strokeWidth={5} />
      <Marker coordinate={coords[0]} pinColor="#0e7c66" title="Pickup" />
      <Marker coordinate={coords[coords.length - 1]} pinColor="#ff7a45" title="Destination" />
    </MapView>
  );
}

export function RideRow({ ride, onPress }: { ride: RideSummary; onPress: () => void }) {
  const { t, money, distance, lang } = useApp();
  const time = (iso: string) => new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${ride.origin.name} to ${ride.destination.name} at ${time(ride.departureAt)}, ${money(ride.pricePerSeatMinor, ride.currency)}`}>
      <Card>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1, gap: 4 }}>
            <T variant="h2">{time(ride.departureAt)} · {ride.origin.name}</T>
            <T variant="small">{distance(ride.distanceMeters)} · {t('ride.duration', { minutes: Math.round(ride.durationSeconds / 60) })}</T>
            <T variant="h2">{time(ride.arrivalEstimateAt)} · {ride.destination.name}</T>
          </View>
          <View style={{ alignItems: 'flex-end' }}><T variant="price">{money(ride.pricePerSeatMinor, ride.currency)}</T><T variant="small">{t('search.perPassenger')}</T></View>
        </View>
        <T variant="muted">{ride.driver.name} · ★ {ride.driver.rating ? ride.driver.rating.toFixed(1) : 'New'} ({ride.driver.ratingCount}){ride.driver.badges.driver ? ` · ✓ ${t('ride.verified')}` : ''}</T>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
          <Pill text={t('search.seatsLeft', { count: ride.seatsAvailable })} />
          {ride.instantBooking && <Pill text={`⚡ ${t('ride.instant')}`} tone="brand" />}
          {ride.womenOnly && <Pill text={t('search.womenOnly')} tone="accent" />}
          {ride.isDemo && <Pill text={t('common.demo')} tone="accent" />}
        </View>
      </Card>
    </Pressable>
  );
}
