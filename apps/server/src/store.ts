import { RuntimeStore } from '../../../packages/runtime/src/store.ts';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  defaultSettings,
  settingsSchema,
  type Settings,
} from '@livra/shared';

export class Store extends RuntimeStore {
  db: DatabaseSync;
  private key: Buffer;
  constructor(public directory: string) {
    super();
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const keyPath = join(directory, 'vault.key');
    if (!existsSync(keyPath)) writeFileSync(keyPath, randomBytes(32), { mode: 0o600, flag: 'wx' });
    this.key = readFileSync(keyPath);
    if (this.key.length !== 32)
      throw Error('Invalid vault.key. Restore your data volume and original key together.');
    this.db = new DatabaseSync(join(directory, 'livra.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sessions (hash TEXT PRIMARY KEY, workspace TEXT NOT NULL, created INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (workspace TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records (workspace TEXT NOT NULL, kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL, updated INTEGER NOT NULL, PRIMARY KEY(workspace,kind,id));
      CREATE INDEX IF NOT EXISTS records_list ON records(workspace,kind,updated DESC);
      PRAGMA user_version=1;`);
  }
  seal(value: unknown) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
  }
  unseal<T>(value: string): T {
    const buf = Buffer.from(value, 'base64');
    const cipher = createDecipheriv('aes-256-gcm', this.key, buf.subarray(0, 12));
    cipher.setAuthTag(buf.subarray(12, 28));
    return JSON.parse(
      Buffer.concat([cipher.update(buf.subarray(28)), cipher.final()]).toString('utf8'),
    );
  }
  session(token?: string) {
    if (!token || !/^[a-f0-9]{64}$/.test(token)) return undefined;
    const row = this.db
      .prepare('SELECT workspace FROM sessions WHERE hash=?')
      .get(createHash('sha256').update(token).digest('hex'));
    return row?.workspace as string | undefined;
  }
  createSession() {
    const token = randomBytes(32).toString('hex'),
      workspace = randomBytes(16).toString('hex');
    this.db
      .prepare('INSERT INTO sessions VALUES(?,?,?)')
      .run(createHash('sha256').update(token).digest('hex'), workspace, Date.now());
    this.saveSettings(workspace, structuredClone(defaultSettings));
    return { token, workspace };
  }
  settings(workspace: string): Settings {
    const row = this.db.prepare('SELECT value FROM settings WHERE workspace=?').get(workspace);
    if (!row) return structuredClone(defaultSettings);
    const raw = this.unseal<Settings>(row.value as string);
    const settings = settingsSchema.parse(raw);
    if (!raw.skinToolsVersion) {
      for (const persona of settings.personas)
        if (
          persona.mode === 'work' &&
          persona.tools.length < 50 &&
          persona.tools.includes('create_marp_theme') &&
          !persona.tools.includes('create_skin')
        )
          persona.tools.push('create_skin');
      this.saveSettings(workspace, settings);
    }
    return settings;
  }
  saveSettings(workspace: string, settings: Settings) {
    this.db
      .prepare('INSERT OR REPLACE INTO settings VALUES(?,?)')
      .run(workspace, this.seal(settings));
  }
  list<T>(workspace: string, kind: string): T[] {
    return this.db
      .prepare(
        'SELECT value FROM records WHERE workspace=? AND kind=? ORDER BY updated DESC LIMIT 1000',
      )
      .all(workspace, kind)
      .map((r) => this.unseal<T>(r.value as string));
  }
  get<T>(workspace: string, kind: string, id: string): T | undefined {
    const row = this.db
      .prepare('SELECT value FROM records WHERE workspace=? AND kind=? AND id=?')
      .get(workspace, kind, id);
    return row ? this.unseal<T>(row.value as string) : undefined;
  }
  put<T extends { id: string }>(workspace: string, kind: string, record: T) {
    this.db
      .prepare('INSERT OR REPLACE INTO records VALUES(?,?,?,?,?)')
      .run(workspace, kind, record.id, this.seal(record), Date.now());
    return record;
  }
  delete(workspace: string, kind: string, id: string) {
    this.db
      .prepare('DELETE FROM records WHERE workspace=? AND kind=? AND id=?')
      .run(workspace, kind, id);
  }
  close() {
    this.db.close();
  }
}
