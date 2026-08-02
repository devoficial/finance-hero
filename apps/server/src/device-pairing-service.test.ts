import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DevicePairingService } from "./device-pairing-service";

const temporaryDirectories: string[] = [];

function createService() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-device-"));
  temporaryDirectories.push(directory);
  return { directory, service: new DevicePairingService(directory) };
}

afterEach(() => {
  vi.useRealTimers();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("DevicePairingService", () => {
  it("issues a single-use code and authenticates only the generated token", () => {
    const { service } = createService();
    const { code } = service.createPairingCode();
    const paired = service.pair(code, "Debasis iPhone");

    expect(service.authenticate(paired.token)?.name).toBe("Debasis iPhone");
    expect(service.authenticate("wrong-token")).toBeUndefined();
    expect(() => service.pair(code, "Second phone")).toThrow(/invalid or expired/i);
  });

  it("rejects an expired pairing code", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-02T08:00:00.000Z"));
    const { service } = createService();
    const { code, expiresAt } = service.createPairingCode();

    vi.setSystemTime(new Date(new Date(expiresAt).getTime() + 1));

    expect(() => service.pair(code, "Late phone")).toThrow(/invalid or expired/i);
    expect(service.list()).toEqual([]);
  });

  it("invalidates a code after five malformed attempts", () => {
    const { service } = createService();
    const { code } = service.createPairingCode();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      expect(() => service.pair("not-a-six-digit-code", "Unknown phone")).toThrow(/invalid or expired/i);
    }

    expect(() => service.pair(code, "Debasis iPhone")).toThrow(/invalid or expired/i);
    expect(service.list()).toEqual([]);
  });

  it("revokes a paired token and treats repeated revocation as a no-op", () => {
    const { service } = createService();
    const paired = service.pair(service.createPairingCode().code, "Debasis iPhone");

    expect(service.authenticate(paired.token)?.id).toBe(paired.id);
    expect(service.revoke(paired.id)).toBe(true);
    expect(service.authenticate(paired.token)).toBeUndefined();
    expect(service.revoke(paired.id)).toBe(false);
  });

  it("recovers safely from malformed device storage", () => {
    const { directory, service } = createService();
    writeFileSync(join(directory, "paired-devices.json"), "{not valid json", "utf8");

    expect(service.list()).toEqual([]);

    const paired = service.pair(service.createPairingCode().code, "  ");
    expect(paired.name).toBe("iPhone");
    expect(service.authenticate(paired.token)?.id).toBe(paired.id);
  });

  it("stores only a token hash and never exposes it from the device list", () => {
    const { directory, service } = createService();
    const paired = service.pair(service.createPairingCode().code, "Debasis iPhone");
    const persisted = readFileSync(join(directory, "paired-devices.json"), "utf8");

    expect(persisted).not.toContain(paired.token);
    expect(persisted).toContain('"tokenHash"');
    expect(service.list()).toEqual([expect.not.objectContaining({ tokenHash: expect.anything() })]);
  });
});
