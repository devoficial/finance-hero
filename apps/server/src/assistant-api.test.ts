import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assistantChatResponseSchema, assistantConversationSchema } from "@finance-hero/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "./app";

const temporaryDirectories: string[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("local finance assistant API", () => {
  it("sends bounded read-only context to Ollama and stores the conversation", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-assistant-api-"));
    temporaryDirectories.push(dataDirectory);
    const modelRequests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
        const modelRequest = JSON.parse(String(init?.body)) as Record<string, unknown>;
        modelRequests.push(modelRequest);
        if (modelRequests.length === 1) {
          return new Response(
            JSON.stringify({
              message: {
                content: "",
                thinking: "Private model reasoning must never be persisted or returned.",
              },
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify({
            message: {
              content:
                "Your bank-confirmed cash balance is the current source of truth. Review the monthly cash bridge for the reconciliation arithmetic.",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }),
    );
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "assistant-api-test-key-with-at-least-32-characters",
        ollamaUrl: "http://127.0.0.1:11434",
        ollamaModel: "local-test-model",
        ollamaFinalizerModel: "local-test-finalizer",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/assistant/chat",
      payload: {
        message: "Explain my current bank cash balance.",
        pageContext: { page: "home", month: "2026-07" },
      },
    });

    expect(response.statusCode).toBe(200);
    const parsed = assistantChatResponseSchema.parse(response.json());
    expect(parsed.localOnly).toBe(true);
    expect(parsed.message.toolTrace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ tool: "month_summary" }),
        expect.objectContaining({ tool: "accounts" }),
      ]),
    );
    const requestText = JSON.stringify(modelRequests);
    expect(requestText).toContain("cashBalanceINR");
    expect(requestText).toContain("cashBalanceSource");
    expect(requestText).not.toContain("cashBalancePaise");
    expect(requestText).not.toContain("CREATE TABLE");
    expect(requestText.length).toBeLessThan(60_000);
    expect(modelRequests).toHaveLength(2);
    expect(modelRequests[0]?.think).toBe(true);
    expect(modelRequests[0]?.model).toBe("local-test-model");
    expect(modelRequests[1]?.think).toBe(false);
    expect(modelRequests[1]?.model).toBe("local-test-finalizer");

    const conversationResponse = await app.inject({
      method: "GET",
      url: `/api/v1/assistant/conversations/${parsed.conversationId}`,
    });
    expect(conversationResponse.statusCode).toBe(200);
    const conversation = assistantConversationSchema.parse(conversationResponse.json());
    expect(conversation.messages).toHaveLength(2);
    expect(JSON.stringify(conversation)).not.toContain("Private model reasoning");
    await app.close();
  });
});
