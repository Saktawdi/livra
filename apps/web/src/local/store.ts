import { defaultSettings, settingsSchema, type Settings } from '@livra/shared';
import { RuntimeStore } from '@livra/runtime/store';

type Entry = { key: string; kind: string; id: string; value: any; updated: number };
const key = (kind: string, id: string) => JSON.stringify([kind, id]);
const completed = (transaction: IDBTransaction) =>
  new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = transaction.onabort = () =>
      reject(transaction.error || Error('浏览器存储写入失败'));
  });

export class BrowserStore extends RuntimeStore {
  override readonly local = true;
  private entries = new Map<string, Entry>();
  private pending = new Set<Promise<void>>();
  private writeError: unknown;
  private batching = false;
  private constructor(private db: IDBDatabase) {
    super();
  }
  static async open(factory: IDBFactory = indexedDB, name = 'livra-local-v1') {
    const request = factory.open(name, 1);
    request.onupgradeneeded = () => request.result.createObjectStore('records', { keyPath: 'key' });
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || Error('无法打开浏览器本地存储'));
      request.onblocked = () => reject(Error('本地存储升级受阻，请关闭其他 Livra 标签页后重试'));
    });
    db.onversionchange = () => db.close();
    const store = new BrowserStore(db);
    const read = db.transaction('records').objectStore('records').getAll();
    const entries = await new Promise<Entry[]>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    store.entries = new Map(entries.map((entry) => [entry.key, entry]));
    return store;
  }
  private persist(entry?: Entry, removeKey?: string) {
    if (this.batching) return;
    const transaction = this.db.transaction('records', 'readwrite');
    const done = completed(transaction);
    if (entry) transaction.objectStore('records').put(entry);
    else transaction.objectStore('records').delete(removeKey!);
    this.pending.add(done);
    void done
      .catch((error) => {
        this.writeError = error;
      })
      .finally(() => this.pending.delete(done));
  }
  async flush() {
    await Promise.allSettled([...this.pending]);
    if (this.writeError) {
      const error = this.writeError;
      this.writeError = undefined;
      throw Error('数据未能保存到浏览器，请检查可用空间或浏览器的存储权限。', { cause: error });
    }
  }
  async batch(action: () => void) {
    await this.flush();
    const before = structuredClone(this.entries);
    this.batching = true;
    try {
      action();
      const transaction = this.db.transaction('records', 'readwrite');
      const done = completed(transaction);
      const objectStore = transaction.objectStore('records');
      objectStore.clear();
      for (const entry of this.entries.values()) objectStore.put(entry);
      await done;
    } catch (error) {
      this.entries = before;
      throw error;
    } finally {
      this.batching = false;
    }
  }
  get initialized() {
    return this.entries.has(key('settings', 'current'));
  }
  settings(_workspace: string): Settings {
    return settingsSchema.parse(
      this.get('browser', 'settings', 'current') || structuredClone(defaultSettings),
    );
  }
  saveSettings(workspace: string, settings: Settings) {
    this.put(workspace, 'settings', { ...settings, id: 'current' });
  }
  list<T>(_workspace: string, kind: string): T[] {
    return [...this.entries.values()]
      .filter((entry) => entry.kind === kind)
      .sort((a, b) => b.updated - a.updated)
      .map((entry) => structuredClone(entry.value));
  }
  get<T>(_workspace: string, kind: string, id: string): T | undefined {
    const entry = this.entries.get(key(kind, id));
    return entry ? structuredClone(entry.value) : undefined;
  }
  put<T extends { id: string }>(_workspace: string, kind: string, value: T): T {
    const entry = {
      key: key(kind, value.id),
      kind,
      id: value.id,
      value: structuredClone(value),
      updated: Date.now(),
    };
    this.entries.set(entry.key, entry);
    this.persist(entry);
    return structuredClone(value);
  }
  delete(_workspace: string, kind: string, id: string) {
    const entryKey = key(kind, id);
    this.entries.delete(entryKey);
    this.persist(undefined, entryKey);
  }
  close() {
    this.db.close();
  }
}
