export interface MutationEnvelope<TData> {
  meta: {
    idempotencyKey: string;
    deviceId: string;
    expectedVersion?: number;
    clientCreatedAt: string;
  };
  data: TData;
}

export interface SyncCursor {
  serverSequence: number;
}

export function createIdempotencyKey(deviceId: string, localSequence: number): string {
  if (!deviceId || !Number.isSafeInteger(localSequence) || localSequence < 1) {
    throw new TypeError("A device ID and positive local sequence are required.");
  }

  return `${deviceId}:${localSequence}`;
}
