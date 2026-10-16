import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import { createSecureStorage } from './secureStorageCore';
const options = { keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY };
let installation: Promise<string> | undefined;
function installationId() {
  return (installation ??= (async () => {
    const saved = await AsyncStorage.getItem('circles:installation-id');
    if (saved) return saved;
    const id = Crypto.randomUUID();
    await AsyncStorage.setItem('circles:installation-id', id);
    return id;
  })());
}
export const secureStorage = createSecureStorage(
  AsyncStorage,
  {
    get: (key) => SecureStore.getItemAsync(key, options),
    set: (key, value) => SecureStore.setItemAsync(key, value, options),
    remove: (key) => SecureStore.deleteItemAsync(key, options),
  },
  async (key) =>
    Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      `${await installationId()}:${key}`,
    ),
  () => Crypto.randomUUID(),
);

export async function migrateLegacyPrivateData() {
  const keys = await secureStorage.getAllKeys();
  for (const key of keys) {
    if (/^(sb-|saved-posts:|circles:(?!installation-id))/.test(key))
      await secureStorage.getItem(key);
  }
}
