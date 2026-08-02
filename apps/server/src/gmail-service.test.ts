import { describe, expect, it, vi } from "vitest";
import type { ServerConfig } from "./config";
import { GmailService, type GmailTokenStore, type StoredGmailCredential } from "./gmail-service";

const READONLY_SCOPE = "https://www.googleapis.com/auth/gmail.readonly";

class MemoryTokenStore implements GmailTokenStore {
  credential: StoredGmailCredential | null = null;

  async load() {
    return this.credential;
  }

  async save(credential: StoredGmailCredential) {
    this.credential = credential;
  }
}

function config(): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 4317,
    dataDirectory: "/tmp/finance-hero-gmail-test",
    googleClientId: "test-client-id",
    googleClientSecret: "test-client-secret",
    googleOwnerEmail: "owner@example.com",
  };
}

describe("GmailService", () => {
  it("starts a state-bound offline authorization with read-only Gmail access", () => {
    const service = new GmailService(config(), new MemoryTokenStore());
    const authorization = new URL(service.createAuthorizationUrl());

    expect(authorization.origin).toBe("https://accounts.google.com");
    expect(authorization.searchParams.get("access_type")).toBe("offline");
    expect(authorization.searchParams.get("scope")?.split(" ")).toContain(READONLY_SCOPE);
    expect(authorization.searchParams.get("redirect_uri")).toBe("http://127.0.0.1:4317/api/v1/gmail/oauth/callback");
    expect(authorization.searchParams.get("state")).toHaveLength(64);
  });

  it("stores a refresh token only for the configured verified owner", async () => {
    const store = new MemoryTokenStore();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", scope: READONLY_SCOPE }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sub: "owner-subject", email: "owner@example.com", email_verified: true }), {
          status: 200,
        }),
      );
    const service = new GmailService(config(), store, fetcher);
    const state = new URL(service.createAuthorizationUrl()).searchParams.get("state") as string;

    const status = await service.completeAuthorization("authorization-code", state);

    expect(status.connected).toBe(true);
    expect(store.credential).toMatchObject({
      refreshToken: "refresh",
      email: "owner@example.com",
      subject: "owner-subject",
      scope: READONLY_SCOPE,
    });
  });

  it("rejects a different Google identity", async () => {
    const store = new MemoryTokenStore();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ access_token: "access", refresh_token: "refresh", scope: READONLY_SCOPE }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ sub: "other-subject", email: "other@example.com", email_verified: true }), {
          status: 200,
        }),
      );
    const service = new GmailService(config(), store, fetcher);
    const state = new URL(service.createAuthorizationUrl()).searchParams.get("state") as string;

    await expect(service.completeAuthorization("authorization-code", state)).rejects.toThrow(
      "not the configured Finance Hero owner",
    );
    expect(store.credential).toBeNull();
  });

  it("discovers supported statement attachments and ignores other files", async () => {
    const store = new MemoryTokenStore();
    store.credential = {
      refreshToken: "refresh",
      email: "owner@example.com",
      subject: "owner-subject",
      scope: READONLY_SCOPE,
      updatedAt: new Date().toISOString(),
    };
    const statement = Buffer.from("Date,Description,Debit\n2026-08-01,Tea,50").toString("base64url");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "access" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ messages: [{ id: "message-1" }] }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            payload: {
              parts: [
                { filename: "statement.csv", mimeType: "text/csv", body: { data: statement } },
                { filename: "logo.png", mimeType: "image/png", body: { data: "aW1hZ2U" } },
              ],
            },
          }),
          { status: 200 },
        ),
      );
    const service = new GmailService(config(), store, fetcher);

    const attachments = await service.discoverAttachments("from:bank has:attachment", 5);

    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ messageId: "message-1", filename: "statement.csv", mimeType: "text/csv" });
    expect(attachments[0]?.content.toString()).toContain("Tea,50");
    expect(String(fetcher.mock.calls[1]?.[0])).toContain("maxResults=5");
  });
});
