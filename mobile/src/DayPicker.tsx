import { Pressable, ScrollView, Text } from 'react-native';
import { useApp } from './lib/app';
import { useColors } from './ui';

/** Horizontal day chips (today + 13 days) — avoids a native date-picker dependency. */
export function DayPicker({ value, onChange }: { value: string; onChange: (d: string) => void }) {
  const { lang } = useApp();
  const c = useColors();
  const days = Array.from({ length: 14 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() + i); return d; });
  const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
      {days.map((d, i) => {
        const k = key(d), sel = k === value;
        return (
          <Pressable key={k} accessibilityRole="radio" accessibilityState={{ selected: sel }} onPress={() => onChange(k)}
            style={{ paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12, borderWidth: 1.5, borderColor: sel ? c.brand : c.line, backgroundColor: sel ? c.brandSoft : c.surface, minWidth: 64, alignItems: 'center' }}>
            <Text style={{ color: c.ink, fontWeight: '700' }}>{i === 0 ? 'Today' : i === 1 ? 'Tmrw' : new Intl.DateTimeFormat(lang, { weekday: 'short' }).format(d)}</Text>
            <Text style={{ color: c.ink2 }}>{d.getDate()}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}
export const todayKey = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
