import Dexie, { type EntityTable } from "dexie";

const CACHE_KEY_ID = "local-cache-aes-gcm-v1";
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

interface EncryptedValue {
  ciphertext: string;
  iv: string;
}

interface StoredOutboxMutation extends EncryptedValue {
  id: string;
  kind: string;
  clientCreatedAt: string;
  expiresAt: string;
  attemptCount: number;
}

interface StoredCacheMetadata extends EncryptedValue {
  key: string;
  expiresAt: string;
}

interface StoredCryptoKey {
  id: string;
  value: CryptoKey;
}

export interface OutboxMutation<T = unknown> {
  id: string;
  kind: string;
  payload: T;
  clientCreatedAt: string;
  expiresAt: string;
  attemptCount: number;
}

class FinanceHeroCache extends Dexie {
  private outbox!: EntityTable<StoredOutboxMutation, "id">;
  private metadata!: EntityTable<StoredCacheMetadata, "key">;
  private encryptionKeys!: EntityTable<StoredCryptoKey, "id">;
  private keyPromise?: Promise<CryptoKey>;

  constructor() {
    super("finance-hero-cache");
    this.version(1).stores({
      outbox: "&id, kind, clientCreatedAt",
      metadata: "&key",
    });
    this.version(2)
      .stores({
        outbox: "&id, kind, clientCreatedAt, expiresAt",
        metadata: "&key, expiresAt",
        encryptionKeys: "&id",
      })
      .upgrade(async (transaction) => {
        // Version 1 never shipped an active outbox. Remove any plaintext records
        // rather than silently carrying sensitive financial data forward.
        await transaction.table("outbox").clear();
        await transaction.table("metadata").clear();
      });
  }

  async queueMutation<T>(input: {
    id: string;
    kind: string;
    payload: T;
    clientCreatedAt?: string;
    expiresAt?: string;
    attemptCount?: number;
  }): Promise<void> {
    const clientCreatedAt = input.clientCreatedAt ?? new Date().toISOString();
    const expiresAt = input.expiresAt ?? new Date(Date.now() + DEFAULT_TTL_MS).toISOString();
    const encrypted = await this.encrypt(`outbox:${input.id}`, input.payload);

    await this.outbox.put({
      id: input.id,
      kind: input.kind,
      clientCreatedAt,
      expiresAt,
      attemptCount: input.attemptCount ?? 0,
      ...encrypted,
    });
  }

  async listMutations<T = unknown>(): Promise<Array<OutboxMutation<T>>> {
    await this.clearExpired();
    const records = await this.outbox.orderBy("clientCreatedAt").toArray();
    return Promise.all(
      records.map(async (record) => ({
        id: record.id,
        kind: record.kind,
        payload: await this.decrypt<T>(`outbox:${record.id}`, record),
        clientCreatedAt: record.clientCreatedAt,
        expiresAt: record.expiresAt,
        attemptCount: record.attemptCount,
      })),
    );
  }

  async removeMutation(id: string): Promise<void> {
    await this.outbox.delete(id);
  }

  async setMetadata<T>(key: string, value: T, expiresAt?: string): Promise<void> {
    const encrypted = await this.encrypt(`metadata:${key}`, value);
    await this.metadata.put({
      key,
      expiresAt: expiresAt ?? new Date(Date.now() + DEFAULT_TTL_MS).toISOString(),
      ...encrypted,
    });
  }

  async getMetadata<T>(key: string): Promise<T | undefined> {
    const record = await this.metadata.get(key);
    if (!record) return undefined;
    if (Date.parse(record.expiresAt) <= Date.now()) {
      await this.metadata.delete(key);
      return undefined;
    }
    return this.decrypt<T>(`metadata:${key}`, record);
  }

  async clearExpired(now = new Date()): Promise<void> {
    const cutoff = now.toISOString();
    await this.transaction("rw", this.outbox, this.metadata, async () => {
      await this.outbox.where("expiresAt").belowOrEqual(cutoff).delete();
      await this.metadata.where("expiresAt").belowOrEqual(cutoff).delete();
    });
  }

  async clearSensitiveCache(): Promise<void> {
    await this.transaction("rw", this.outbox, this.metadata, async () => {
      await this.outbox.clear();
      await this.metadata.clear();
    });
  }

  private async getEncryptionKey(): Promise<CryptoKey> {
    this.keyPromise ??= this.loadOrCreateEncryptionKey();
    return this.keyPromise;
  }

  private async loadOrCreateEncryptionKey(): Promise<CryptoKey> {
    const existing = await this.encryptionKeys.get(CACHE_KEY_ID);
    if (existing) return existing.value;

    const value = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    await this.encryptionKeys.put({ id: CACHE_KEY_ID, value });
    return value;
  }

  private async encrypt(scope: string, value: unknown): Promise<EncryptedValue> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const plaintext = new TextEncoder().encode(JSON.stringify(value));
    const additionalData = new TextEncoder().encode(scope);
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData },
      await this.getEncryptionKey(),
      plaintext,
    );
    return { ciphertext: toBase64(new Uint8Array(ciphertext)), iv: toBase64(iv) };
  }

  private async decrypt<T>(scope: string, value: EncryptedValue): Promise<T> {
    const plaintext = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: fromBase64(value.iv),
        additionalData: new TextEncoder().encode(scope),
      },
      await this.getEncryptionKey(),
      fromBase64(value.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as T;
  }
}

function toBase64(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string): ArrayBuffer {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0)).buffer;
}

// The key is non-extractable and payloads are encrypted at rest. This protects
// cached data from casual disk inspection, not from code already executing in
// the Finance Hero origin; CSP and server hardening remain the XSS boundary.
export const localCache = new FinanceHeroCache();
