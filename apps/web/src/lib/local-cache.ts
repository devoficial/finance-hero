import Dexie, { type EntityTable } from "dexie";

export interface OutboxMutation {
  id: string;
  kind: string;
  payload: string;
  clientCreatedAt: string;
  attemptCount: number;
}

export interface CacheMetadata {
  key: string;
  value: string;
}

class FinanceHeroCache extends Dexie {
  outbox!: EntityTable<OutboxMutation, "id">;
  metadata!: EntityTable<CacheMetadata, "key">;

  constructor() {
    super("finance-hero-cache");
    this.version(1).stores({
      outbox: "&id, kind, clientCreatedAt",
      metadata: "&key",
    });
  }
}

export const localCache = new FinanceHeroCache();
