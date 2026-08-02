import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

interface StoredDevice {
  id: string;
  name: string;
  tokenHash: string;
  pairedAt: string;
  lastSeenAt: string | null;
}

interface PairingCode {
  value: string;
  expiresAt: number;
  failedAttempts: number;
}

export class DevicePairingService {
  private readonly path: string;
  private pairingCode?: PairingCode;

  constructor(dataDirectory: string) {
    mkdirSync(dataDirectory, { recursive: true, mode: 0o700 });
    this.path = join(dataDirectory, "paired-devices.json");
  }

  createPairingCode() {
    this.pairingCode = {
      value: String(randomInt(0, 1_000_000)).padStart(6, "0"),
      expiresAt: Date.now() + 10 * 60_000,
      failedAttempts: 0,
    };
    return { code: this.pairingCode.value, expiresAt: new Date(this.pairingCode.expiresAt).toISOString() };
  }

  pair(code: string, name: string) {
    if (!this.pairingCode || this.pairingCode.expiresAt < Date.now()) {
      throw new Error("The pairing code is invalid or expired.");
    }
    if (code !== this.pairingCode.value) {
      this.pairingCode.failedAttempts += 1;
      if (this.pairingCode.failedAttempts >= 5) this.pairingCode = undefined;
      throw new Error("The pairing code is invalid or expired.");
    }
    this.pairingCode = undefined;
    const token = randomBytes(32).toString("base64url");
    const now = new Date().toISOString();
    const device: StoredDevice = {
      id: randomBytes(12).toString("hex"),
      name: name.trim().slice(0, 80) || "iPhone",
      tokenHash: this.hash(token),
      pairedAt: now,
      lastSeenAt: null,
    };
    const devices = [...this.read(), device];
    this.write(devices);
    return { id: device.id, name: device.name, token, pairedAt: now };
  }

  authenticate(token: string): StoredDevice | undefined {
    const hash = this.hash(token);
    const devices = this.read();
    const device = devices.find((item) => this.equal(item.tokenHash, hash));
    if (!device) return undefined;
    device.lastSeenAt = new Date().toISOString();
    this.write(devices);
    return device;
  }

  list() {
    return this.read().map(({ tokenHash: _tokenHash, ...device }) => device);
  }

  revoke(id: string): boolean {
    const devices = this.read();
    const next = devices.filter((device) => device.id !== id);
    if (next.length === devices.length) return false;
    this.write(next);
    return true;
  }

  private hash(value: string): string {
    return createHash("sha256").update(value).digest("hex");
  }

  private equal(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private read(): StoredDevice[] {
    if (!existsSync(this.path)) return [];
    try {
      const value = JSON.parse(readFileSync(this.path, "utf8"));
      return Array.isArray(value) ? value : [];
    } catch {
      return [];
    }
  }

  private write(devices: StoredDevice[]) {
    writeFileSync(this.path, `${JSON.stringify(devices, null, 2)}\n`, { mode: 0o600 });
    chmodSync(this.path, 0o600);
  }
}
