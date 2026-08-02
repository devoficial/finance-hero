import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DevicePairingService } from "./device-pairing-service";

describe("DevicePairingService", () => {
  it("issues a single-use code and authenticates only the generated token", () => {
    const service = new DevicePairingService(mkdtempSync(join(tmpdir(), "finance-hero-device-")));
    const { code } = service.createPairingCode();
    const paired = service.pair(code, "Debasis iPhone");

    expect(service.authenticate(paired.token)?.name).toBe("Debasis iPhone");
    expect(service.authenticate("wrong-token")).toBeUndefined();
    expect(() => service.pair(code, "Second phone")).toThrow(/invalid or expired/i);
  });
});
