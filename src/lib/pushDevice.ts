import { randomUUID } from 'expo-crypto';
import { secureStorage } from './secureStorage';
import { requireSupabase } from './supabase';
const activeKey = 'circles:device-push-ownership';
const pendingKey = 'circles:pending-push-deregistration';
type Device = { token: string; key: string };
export async function registerPushDevice(token: string) {
  await flushPendingPushDeregistration();
  const device = { token, key: randomUUID() };
  // Keep the proof before registration, so a lost response can still be revoked.
  await secureStorage.setItem(activeKey, JSON.stringify(device));
  const result = await requireSupabase().rpc('register_push_token', {
    push_token: token,
    device_key: device.key,
  });
  if (result.error) throw result.error;
  await secureStorage.setItem('circles:device-push-token', token);
}
export async function flushPendingPushDeregistration() {
  const saved = await secureStorage.getItem(pendingKey);
  if (!saved) return;
  const device: Device = JSON.parse(saved);
  const result = await requireSupabase().rpc('unregister_push_device', {
    push_token: device.token,
    device_key: device.key,
  });
  if (result.error) throw result.error;
  if ((await secureStorage.getItem(pendingKey)) === saved)
    await secureStorage.removeItem(pendingKey);
}
export async function deregisterPushDevice() {
  const saved = await secureStorage.getItem(activeKey);
  if (saved) {
    await secureStorage.setItem(pendingKey, saved);
    await secureStorage.removeItem(activeKey);
    await flushPendingPushDeregistration();
  } else {
    // Upgrade path for devices registered before ownership proofs were introduced.
    const token = await secureStorage.getItem('circles:device-push-token');
    if (token) {
      const result = await requireSupabase().from('device_push_tokens').delete().eq('token', token);
      if (result.error) throw result.error;
    }
  }
  await secureStorage.removeItem('circles:device-push-token');
}
