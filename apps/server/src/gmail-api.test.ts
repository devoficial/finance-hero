import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";
import type { GmailConnector } from "./gmail-service";

const temporaryDirectories: string[] = [];
const READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly" as const;

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function fakeGmail(): GmailConnector {
  return {
    status: vi.fn(async () => ({
      configured: true,
      connected: true,
      ownerEmail: "owner@example.com",
      scope: READONLY_SCOPE,
      message: "Gmail is connected read-only.",
    })),
    createAuthorizationUrl: vi.fn(() => "https://accounts.google.com/o/oauth2/v2/auth?state=test"),
    completeAuthorization: vi.fn(async () => ({
      configured: true,
      connected: true,
      ownerEmail: "owner@example.com",
      scope: READONLY_SCOPE,
      message: "Gmail is connected read-only.",
    })),
    discoverAttachments: vi.fn(async () => []),
  };
}

describe("Gmail import API", () => {
  it("reports connection status and starts owner authorization", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-gmail-api-"));
    temporaryDirectories.push(dataDirectory);
    const gmail = fakeGmail();
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "gmail-api-test-key-with-at-least-32-characters",
      },
      gmailService: gmail,
    });

    const status = await app.inject({ method: "GET", url: "/api/v1/gmail/status" });
    expect(status.statusCode).toBe(200);
    expect(status.json()).toMatchObject({ connected: true, ownerEmail: "owner@example.com" });

    const start = await app.inject({ method: "GET", url: "/api/v1/gmail/oauth/start" });
    expect(start.statusCode).toBe(302);
    expect(start.headers.location).toContain("accounts.google.com");
    await app.close();
  });

  it("runs manual discovery without posting anything to the ledger", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-gmail-discovery-"));
    temporaryDirectories.push(dataDirectory);
    const gmail = fakeGmail();
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "gmail-discovery-test-key-at-least-32-characters",
      },
      gmailService: gmail,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/gmail/discover",
      payload: { query: "newer_than:30d has:attachment", maxMessages: 25 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ attachmentsFound: 0, imported: 0, duplicates: 0, failed: 0 });
    expect(gmail.discoverAttachments).toHaveBeenCalledWith("newer_than:30d has:attachment", 25);
    await app.close();
  });
});
