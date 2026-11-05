import AsyncStorage from '@react-native-async-storage/async-storage';

/** Offline cache for non-sensitive read data (trip lists, ride details). Spec §72. */
export async function cached<T>(key: string, fetcher: () => Promise<T>): Promise<{ data: T; fromCache: boolean }> {
  try {
    const data = await fetcher();
    AsyncStorage.setItem(`cache:${key}`, JSON.stringify({ at: Date.now(), data })).catch(() => {});
    return { data, fromCache: false };
  } catch (e: any) {
    if (e?.code !== 'NETWORK' && e?.code !== 'OFFLINE') throw e;
    const raw = await AsyncStorage.getItem(`cache:${key}`);
    if (!raw) throw e;
    return { data: JSON.parse(raw).data as T, fromCache: true };
  }
}

/** Queue for non-critical actions (e.g. mark notifications read) replayed when back online. Never used for bookings or payments. */
export async function enqueue(action: { path: string; method: string; body?: unknown }) {
  const q = JSON.parse((await AsyncStorage.getItem('queue')) ?? '[]');
  q.push(action);
  await AsyncStorage.setItem('queue', JSON.stringify(q.slice(-50)));
}
export async function drain(run: (a: { path: string; method: string; body?: unknown }) => Promise<unknown>) {
  const q = JSON.parse((await AsyncStorage.getItem('queue')) ?? '[]');
  await AsyncStorage.setItem('queue', '[]');
  for (const a of q) await run(a).catch(() => {});
}
