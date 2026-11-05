import { useEffect, useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { enqueue } from '@/lib/cache';
import { useApp } from '@/lib/app';
import { Card, T, useColors } from '@/ui';

/** Notifications (screen 20). "Mark read" is non-critical → queued if offline. */
export default function Notifications() {
  const { t, online } = useApp();
  const c = useColors();
  const [items, setItems] = useState<any[]>([]);
  useEffect(() => {
    api('/notifications').then((d) => {
      setItems(d.items);
      if (d.unread) (online ? api('/notifications/read', { method: 'POST', body: {} }) : enqueue({ path: '/notifications/read', method: 'POST', body: {} })).catch(() => {});
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <FlatList style={{ backgroundColor: c.bg }} contentContainerStyle={{ padding: 16, gap: 10 }} data={items} keyExtractor={(n) => n.id}
      ListEmptyComponent={<T variant="muted">You're all caught up.</T>}
      renderItem={({ item: n }) => (
        <Pressable onPress={() => n.data?.rideId && router.push(`/ride/${n.data.rideId}`)}>
          <Card style={{ borderLeftWidth: n.readAt ? 1 : 4, borderLeftColor: n.readAt ? c.line : c.brand }}>
            <T style={{ fontWeight: '700' }}>{n.title}</T>
            <T variant="muted">{n.body}</T>
            <View><T variant="small">{new Date(n.createdAt).toLocaleString()}</T></View>
          </Card>
        </Pressable>
      )} />
  );
}
