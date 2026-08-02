import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp, redactRequestUrl } from "./app";

const temporaryDirectories: string[] = [];

function testConfig() {
  const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-security-"));
  temporaryDirectories.push(dataDirectory);
  return { host: "127.0.0.1", port: 4317, dataDirectory };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("API security boundaries", () => {
  it("marks every response private and adds browser security headers", async () => {
    const app = await buildApp({ config: testConfig() });
    const response = await app.inject({ method: "GET", url: "/api/v1/health" });

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "cache-control": "private, no-store, max-age=0",
      pragma: "no-cache",
      expires: "0",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "referrer-policy": "no-referrer",
      "permissions-policy": "camera=(), microphone=(), geolocation=()",
      "cross-origin-resource-policy": "same-origin",
    });

    await app.close();
  });

  it("allows pairing administration only from the Mac loopback interface", async () => {
    const app = await buildApp({ config: testConfig() });
    const remoteCreate = await app.inject({
      method: "POST",
      url: "/api/v1/devices/pairing-code",
      remoteAddress: "192.168.1.25",
    });
    const remoteList = await app.inject({
      method: "GET",
      url: "/api/v1/devices",
      remoteAddress: "192.168.1.25",
    });
    const localCreate = await app.inject({ method: "POST", url: "/api/v1/devices/pairing-code" });

    expect(remoteCreate.statusCode).toBe(403);
    expect(remoteCreate.json()).toMatchObject({ error: { code: "LOCAL_ADMIN_REQUIRED" } });
    expect(remoteList.statusCode).toBe(403);
    expect(localCreate.statusCode).toBe(200);

    await app.close();
  });

  it("keeps the phone pairing exchange reachable on the trusted LAN", async () => {
    const app = await buildApp({ config: testConfig() });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/devices/pair",
      remoteAddress: "192.168.1.25",
      payload: {},
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({ error: { code: "PAIRING_FAILED" } });

    await app.close();
  });

  it("rate limits repeated pairing-code generation", async () => {
    const app = await buildApp({ config: testConfig() });
    for (let index = 0; index < 10; index += 1) {
      const response = await app.inject({ method: "POST", url: "/api/v1/devices/pairing-code" });
      expect(response.statusCode).toBe(200);
    }

    const limited = await app.inject({ method: "POST", url: "/api/v1/devices/pairing-code" });
    expect(limited.statusCode).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
    expect(limited.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });

    await app.close();
  });

  it("redacts query strings before request URLs reach logs", () => {
    expect(redactRequestUrl("/api/v1/example?token=secret&code=private")).toBe("/api/v1/example?[redacted]");
    expect(redactRequestUrl("/api/v1/health")).toBe("/api/v1/health");
  });
});
