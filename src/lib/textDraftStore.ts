interface TextStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

/** Share one store across composers so reopening waits for earlier writes. */
export function createTextDraftStore(storage: TextStorage) {
  const writes = new Map<string, Promise<void>>();
  const versions = new Map<string, number>();
  const version = (key: string) => versions.get(key) ?? 0;

  async function read(key: string) {
    await writes.get(key)?.catch(() => {});
    return storage.getItem(key);
  }

  function save(key: string, value: string) {
    versions.set(key, version(key) + 1);
    // A failed write must not prevent subsequent edits from being saved.
    const pending = (writes.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(() => storage.setItem(key, value));
    writes.set(key, pending);
    const release = () => {
      if (writes.get(key) === pending) writes.delete(key);
    };
    void pending.then(release, release);
    return pending;
  }

  return { read, save, version };
}
