import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { initializeFoundationSchema, openEncryptedDatabase } from "./encrypted-database";
import { ImportRepository } from "./import-repository";
import { LedgerRepository } from "./ledger-repository";
import { seedAcceptedOpeningSnapshot } from "./opening-seed";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

function createRepository() {
  const directory = mkdtempSync(join(tmpdir(), "finance-hero-imports-"));
  temporaryDirectories.push(directory);
  const database = openEncryptedDatabase(
    join(directory, "finance-hero.db"),
    Buffer.from("import-test-key-with-at-least-32-characters"),
  );
  initializeFoundationSchema(database);
  seedAcceptedOpeningSnapshot(database);
  const ledger = new LedgerRepository(database);
  return { database, ledger, repository: new ImportRepository(database, ledger) };
}

describe("import repository", () => {
  it("creates a review queue and treats the same file hash as a duplicate", () => {
    const { database, repository } = createRepository();
    const input = {
      filename: "bank.csv",
      contentHash: "test-hash",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed" as const,
      parserMessage: "1 transaction candidate extracted.",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-20",
          payee: "Test Cafe",
          amountPaise: 42500,
          direction: "debit" as const,
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: { Date: "20/07/2026", Description: "Test Cafe" },
        },
      ],
    };

    expect(repository.createArtifact(input).duplicate).toBe(false);
    expect(repository.createArtifact(input).duplicate).toBe(true);
    expect(repository.getQueue()).toMatchObject({
      pendingCount: 1,
      artifacts: [expect.objectContaining({ filename: "bank.csv", rowCount: 1 })],
      candidates: [expect.objectContaining({ payee: "Test Cafe", status: "pending" })],
    });
    database.close();
  });

  it("edits and atomically approves candidates into the balanced ledger", () => {
    const { database, ledger, repository } = createRepository();
    repository.createArtifact({
      filename: "bank.csv",
      contentHash: "approval-hash",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: null,
          payee: "Unclear merchant",
          amountPaise: 50000,
          direction: "debit",
          confidence: 45,
          warnings: ["Date needs review", "Choose an expense category"],
          source: {},
        },
        {
          sourceRow: 3,
          occurredOn: "2026-07-21",
          payee: "Monthly salary",
          amountPaise: 30000000,
          direction: "credit",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    const queue = repository.getQueue();
    const expense = queue.candidates.find((candidate) => candidate.direction === "debit");
    const income = queue.candidates.find((candidate) => candidate.direction === "credit");
    if (!expense || !income) throw new Error("Expected test candidates.");

    const updated = repository.updateCandidate(expense.id, {
      occurredOn: "2026-07-21",
      payee: "Corrected merchant",
      categoryId: "category-groceries",
    });
    expect(updated.version).toBe(2);
    expect(updated.warnings).toEqual([]);
    expect(updated.confidence).toBe(85);

    const approved = repository.approveCandidates([expense.id, income.id]);
    expect(approved.pendingCount).toBe(0);
    expect(approved.approvedCount).toBe(2);
    const transactions = ledger.listTransactions("2026-07");
    expect(transactions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ payee: "Corrected merchant", kind: "expense", amountPaise: 50000 }),
        expect.objectContaining({ payee: "Monthly salary", kind: "income", amountPaise: 30000000 }),
      ]),
    );
    for (const candidate of approved.candidates) {
      const balance = database.connection
        .prepare("SELECT SUM(amount_paise) AS total FROM postings WHERE transaction_id = ?")
        .get(candidate.transactionId) as { total: number };
      expect(balance.total).toBe(0);
    }
    database.close();
  });

  it("blocks approval when review fields are incomplete and supports audited rejection", () => {
    const { database, repository } = createRepository();
    repository.createArtifact({
      filename: "bank.csv",
      contentHash: "reject-hash",
      mimeType: "text/csv",
      sizeBytes: 80,
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: null,
          payee: "Unknown",
          amountPaise: 10000,
          direction: "debit",
          confidence: 30,
          warnings: ["Date needs review"],
          source: {},
        },
      ],
    });
    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected test candidate.");

    expect(() => repository.approveCandidates([candidate.id])).toThrow("needs a valid date and account");
    const rejected = repository.rejectCandidates([candidate.id], "Not my transaction");
    expect(rejected.rejectedCount).toBe(1);
    expect(rejected.candidates[0]?.rejectionReason).toBe("Not my transaction");
    database.close();
  });

  it("replaces unposted parser candidates but protects posted ledger entries", () => {
    const { database, repository } = createRepository();
    const created = repository.createArtifact({
      filename: "statement.pdf",
      contentHash: "reparse-hash",
      mimeType: "application/pdf",
      sizeBytes: 800,
      accountId: "account-primary-bank",
      status: "needs_parser",
      parserMessage: "Password required.",
      rows: [],
    });

    const reparsed = repository.replaceArtifactParseResult(created.artifact.id, {
      status: "parsed",
      parserMessage: "1 transaction candidate extracted.",
      rows: [
        {
          sourceRow: 1,
          occurredOn: "2026-07-22",
          payee: "Local store",
          amountPaise: 75000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: { Source: "PDF page 1" },
        },
      ],
    });
    expect(reparsed).toMatchObject({ status: "parsed", rowCount: 1, pendingCount: 1 });

    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected reparsed candidate.");
    repository.approveCandidates([candidate.id]);
    expect(() =>
      repository.replaceArtifactParseResult(created.artifact.id, {
        status: "parsed",
        rows: [],
      }),
    ).toThrow("posted candidates cannot be parsed again");
    database.close();
  });
});
