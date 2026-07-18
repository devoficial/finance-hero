import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { healthResponseSchema } from "@finance-hero/contracts";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "./app";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("local API", () => {
  it("reports an encrypted database when configured", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-server-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-test-key-with-at-least-32-characters",
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/v1/health" });
    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.parse(response.json()).database).toBe("encrypted");
    await app.close();
  });
});
