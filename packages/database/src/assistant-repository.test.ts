import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AssistantRepository } from "./assistant-repository";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("assistant repository", () => {
  it("stores conversations and sources inside the encrypted database", () => {
    const directory = mkdtempSync(join(tmpdir(), "finance-hero-assistant-"));
    temporaryDirectories.push(directory);
    const database = openEncryptedDatabase(
      join(directory, "finance-hero.db"),
      Buffer.from("assistant-test-key-with-at-least-32-characters"),
    );
    initializeFoundationSchema(database);
    const repository = new AssistantRepository(database);

    const conversationId = repository.createConversation("Explain my cash balance");
    repository.addMessage(conversationId, "user", "Explain my cash balance");
    repository.addMessage(
      conversationId,
      "assistant",
      "The bank-confirmed balance is authoritative.",
      [
        {
          id: "knowledge-finance-hero-calculations",
          title: "Finance Hero calculation rules",
          publisher: "Finance Hero",
          sourceUrl: null,
          effectiveDate: "2026-07-30",
        },
      ],
      [{ tool: "accounts", label: "Read account balances" }],
    );

    const conversation = repository.getConversation(conversationId);
    expect(conversation?.messages).toHaveLength(2);
    expect(conversation?.messages[1]).toMatchObject({
      role: "assistant",
      toolTrace: [{ tool: "accounts", label: "Read account balances" }],
    });
    expect(repository.searchKnowledge("How is cash balance calculated?")[0]?.id).toBe(
      "knowledge-finance-hero-calculations",
    );
    expect(repository.searchKnowledge("How should I approach budgeting?")[0]).toMatchObject({
      id: "knowledge-sebi-budgeting",
      publisher: "SEBI Investor",
    });
    database.close();
  });
});
