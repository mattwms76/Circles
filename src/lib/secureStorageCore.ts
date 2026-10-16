interface LegacyStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
  getAllKeys(): Promise<readonly string[]>;
}
interface Vault {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}
const indexKey = 'circles:secure-storage-index';
type Manifest = { generation: string; count: number };
/** Serialized, atomic pointer swaps; no token/draft payload is written to legacy storage. */
export function createSecureStorage(
  legacy: LegacyStorage,
  vault: Vault,
  hash: (key: string) => Promise<string>,
  generation: () => string,
) {
  let pending: Promise<unknown> = Promise.resolve();
  const queue = <T>(job: () => Promise<T>): Promise<T> => {
    const next = pending.catch(() => {}).then(job);
    pending = next;
    return next;
  };
  const index = async (): Promise<string[]> => {
    const raw = await legacy.getItem(indexKey);
    if (!raw) return [];
    const value = JSON.parse(raw);
    if (!Array.isArray(value) || value.some((k) => typeof k !== 'string'))
      throw Error('Saved data index is unavailable.');
    return value;
  };
  const manifest = async (key: string): Promise<Manifest | null> => {
    const raw = await vault.get(key);
    if (raw === null) return null;
    const value = JSON.parse(raw);
    if (
      !value ||
      !/^[a-zA-Z0-9-]+$/.test(value.generation) ||
      !Number.isInteger(value.count) ||
      value.count < 0 ||
      value.count > 4096
    )
      throw Error('Secure saved data is unavailable.');
    return value;
  };
  const clean = async (key: string, old: Manifest | null) => {
    if (old)
      await Promise.all(
        Array.from({ length: old.count }, (_, i) => vault.remove(`${key}.${old.generation}.${i}`)),
      );
  };
  const write = async (key: string, value: string | null) => {
    const id = 'circles.' + (await hash(key)),
      old = await manifest(id);
    // Add a sentinel so an empty string remains distinct from a deleted key.
    const encoded = value === null ? '' : 'v' + value;
    const characters = Array.from(encoded);
    const chunks: string[] = [];
    for (let i = 0; i < characters.length; i += 400)
      chunks.push(characters.slice(i, i + 400).join(''));
    if (chunks.length > 4096) throw Error('Saved data is too large.');
    const next = { generation: generation(), count: chunks.length };
    const keys = await index();
    // Index contains key names only. Register before writing so deletion can find it after a crash.
    if (!keys.includes(key)) await legacy.setItem(indexKey, JSON.stringify([...keys, key]));
    try {
      for (let i = 0; i < next.count; i++)
        await vault.set(`${id}.${next.generation}.${i}`, chunks[i]);
      await vault.set(id, JSON.stringify(next));
    } catch (error) {
      await clean(id, next).catch(() => {});
      throw error;
    }
    // A secure tombstone prevents stale plaintext resurrection if legacy removal fails.
    await legacy.removeItem(key);
    await clean(id, old).catch(() => {});
  };
  const storage = {
    getItem: (key: string) =>
      queue(async () => {
        const id = 'circles.' + (await hash(key)),
          saved = await manifest(id);
        if (saved) {
          await legacy.removeItem(key);
          if (!saved.count) return null;
          const chunks = await Promise.all(
            Array.from({ length: saved.count }, (_, i) =>
              vault.get(`${id}.${saved.generation}.${i}`),
            ),
          );
          if (chunks.some((x) => x === null))
            throw Error('Secure saved data is incomplete. Sign in again.');
          const value = chunks.join('');
          if (!value.startsWith('v')) throw Error('Secure saved data is invalid.');
          return value.slice(1);
        }
        const old = await legacy.getItem(key);
        if (old !== null) await write(key, old);
        return old;
      }),
    setItem: (key: string, value: string) => queue(() => write(key, value)),
    removeItem: (key: string) => queue(() => write(key, null)),
    getAllKeys: () =>
      queue(async () => [
        ...new Set([
          ...(await legacy.getAllKeys()).filter((k) => k !== indexKey),
          ...(await index()),
        ]),
      ]),
    multiGet: (keys: readonly string[]) =>
      Promise.all(
        keys.map(async (key) => [key, await storage.getItem(key)] as [string, string | null]),
      ),
    multiRemove: (keys: readonly string[]) =>
      Promise.all(keys.map((key) => storage.removeItem(key))).then(() => {}),
  };
  return storage;
}
