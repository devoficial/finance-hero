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

  it("moves approved and rejected candidates back to pending without duplicating ledger totals", () => {
    const { database, repository } = createRepository();
    repository.createArtifact({
      filename: "reset.csv",
      contentHash: "reset-hash",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-22",
          payee: "Approved purchase",
          amountPaise: 50000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
        {
          sourceRow: 3,
          occurredOn: "2026-07-23",
          payee: "Rejected purchase",
          amountPaise: 25000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    const [approvedCandidate, rejectedCandidate] = repository.getQueue().candidates;
    if (!approvedCandidate || !rejectedCandidate) throw new Error("Expected reset candidates.");

    const approved = repository.approveCandidates([approvedCandidate.id]);
    const linkedTransactionId = approved.candidates.find(
      (candidate) => candidate.id === approvedCandidate.id,
    )?.transactionId;
    if (!linkedTransactionId) throw new Error("Expected linked transaction.");
    repository.rejectCandidates([rejectedCandidate.id], "Duplicate statement row");

    const reset = repository.resetCandidatesToPending([approvedCandidate.id, rejectedCandidate.id]);
    expect(reset).toMatchObject({ pendingCount: 2, approvedCount: 0, rejectedCount: 0 });
    expect(reset.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approvedCandidate.id,
          status: "pending",
          transactionId: null,
          rejectionReason: null,
          version: 2,
        }),
        expect.objectContaining({
          id: rejectedCandidate.id,
          status: "pending",
          transactionId: null,
          rejectionReason: null,
          version: 2,
        }),
      ]),
    );
    expect(
      database.connection.prepare("SELECT status FROM journal_transactions WHERE id = ?").get(linkedTransactionId),
    ).toEqual({ status: "reversed" });

    const reapproved = repository.approveCandidates([approvedCandidate.id]);
    const replacementTransactionId = reapproved.candidates.find(
      (candidate) => candidate.id === approvedCandidate.id,
    )?.transactionId;
    expect(replacementTransactionId).not.toBe(linkedTransactionId);
    expect(
      database.connection.prepare("SELECT status FROM journal_transactions WHERE id = ?").get(replacementTransactionId),
    ).toEqual({ status: "posted" });
    database.close();
  });

  it("replaces the matching migrated aggregate amount without changing the accepted month total", () => {
    const { database, ledger, repository } = createRepository();
    const juneBefore = ledger.getDashboard("2026-06", 30);
    const julyBefore = ledger.getDashboard("2026-07", 31);
    repository.createArtifact({
      filename: "dated-statement.csv",
      contentHash: "dated-approval-hash",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-06-15",
          payee: "June grocery",
          amountPaise: 12345,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected dated candidate.");

    repository.approveCandidates([candidate.id]);

    const juneAfter = ledger.getDashboard("2026-06", 30);
    const julyAfter = ledger.getDashboard("2026-07", 31);
    expect(juneAfter.regularExpensePaise).toBe(juneBefore.regularExpensePaise);
    expect(juneAfter.totalExpensePaise).toBe(juneBefore.totalExpensePaise);
    expect(julyAfter.totalExpensePaise).toBe(julyBefore.totalExpensePaise);
    expect(ledger.listTransactions("2026-06")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          occurredOn: "2026-06-15",
          payee: "June grocery",
          kind: "expense",
          amountPaise: 12345,
        }),
      ]),
    );
    repository.resetCandidatesToPending([candidate.id]);
    expect(ledger.getDashboard("2026-06", 30).regularExpensePaise).toBe(juneBefore.regularExpensePaise);
    database.close();
  });

  it("detects the same transaction across differently encoded source files and requires resolution", () => {
    const { database, repository } = createRepository();
    const base = {
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed" as const,
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-20",
          payee: "UPI/P2M/123456789/SWIGGY PAYMENT",
          amountPaise: 42500,
          direction: "debit" as const,
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    };
    repository.createArtifact({
      ...base,
      filename: "statement.pdf",
      contentHash: "semantic-duplicate-pdf",
      mimeType: "application/pdf",
    });
    repository.createArtifact({
      ...base,
      filename: "statement.csv",
      contentHash: "semantic-duplicate-csv",
      mimeType: "text/csv",
    });
    const queue = repository.getQueue();
    const duplicate = queue.candidates.find((candidate) => candidate.duplicateResolution === "suspected");
    expect(duplicate).toMatchObject({
      duplicateConfidence: 100,
      duplicatePayee: "UPI/P2M/123456789/SWIGGY PAYMENT",
      duplicateFilename: "statement.pdf",
    });
    expect(() => repository.approveCandidates([duplicate?.id ?? ""])).toThrow("matches an existing transaction");

    repository.resolveDuplicate(duplicate?.id ?? "", "merge");
    expect(repository.getQueue()).toMatchObject({ pendingCount: 1, rejectedCount: 1 });
    database.close();
  });

  it("allows an explicitly distinct same-day transaction and records the decision", () => {
    const { database, repository } = createRepository();
    for (const [index, hash] of ["distinct-a", "distinct-b"].entries()) {
      repository.createArtifact({
        filename: `${hash}.csv`,
        contentHash: hash,
        mimeType: "text/csv",
        sizeBytes: 100,
        accountId: "account-primary-bank",
        status: "parsed",
        rows: [
          {
            sourceRow: 2,
            occurredOn: "2026-07-20",
            payee: "METRO TICKET",
            amountPaise: 5000,
            direction: "debit",
            categoryId: "category-transport",
            confidence: 85,
            warnings: [],
            source: { Copy: String(index) },
          },
        ],
      });
    }
    const duplicate = repository
      .getQueue()
      .candidates.find((candidate) => candidate.duplicateResolution === "suspected");
    repository.resolveDuplicate(duplicate?.id ?? "", "keep_distinct");
    expect(repository.getQueue().candidates.find((candidate) => candidate.id === duplicate?.id)).toMatchObject({
      duplicateResolution: "distinct",
    });
    expect(() => repository.approveCandidates([duplicate?.id ?? ""])).not.toThrow();
    database.close();
  });

  it("posts balanced split expenses and rebases each migrated category", () => {
    const { database, ledger, repository } = createRepository();
    const before = ledger.getDashboard("2026-07", 31);
    repository.createArtifact({
      filename: "split.csv",
      contentHash: "split-import",
      mimeType: "text/csv",
      sizeBytes: 100,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-20",
          payee: "SUPERMARKET AND PHARMACY",
          amountPaise: 100000,
          direction: "debit",
          confidence: 60,
          warnings: [],
          source: {},
        },
      ],
    });
    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected split candidate.");
    repository.updateCandidate(candidate.id, {
      categoryId: null,
      splits: [
        { categoryId: "category-groceries", amountPaise: 70000 },
        { categoryId: "category-medical", amountPaise: 30000 },
      ],
    });
    const approved = repository.approveCandidates([candidate.id]);
    const transaction = ledger
      .listTransactions("2026-07")
      .find((item) => item.id === approved.candidates.find((item) => item.id === candidate.id)?.transactionId);
    expect(transaction?.splits).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ categoryId: "category-groceries", amountPaise: 70000 }),
        expect.objectContaining({ categoryId: "category-medical", amountPaise: 30000 }),
      ]),
    );
    expect(ledger.getDashboard("2026-07", 31).regularExpensePaise).toBe(before.regularExpensePaise);
    database.close();
  });

  it("learns an exact merchant assignment rule for later source files", () => {
    const { database, repository } = createRepository();
    repository.createArtifact({
      filename: "first.csv",
      contentHash: "merchant-rule-first",
      mimeType: "text/csv",
      sizeBytes: 100,
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-20",
          payee: "LOCAL TIFFIN SERVICE",
          amountPaise: 25000,
          direction: "debit",
          confidence: 55,
          warnings: [],
          source: {},
        },
      ],
    });
    const first = repository.getQueue().candidates[0];
    if (!first) throw new Error("Expected merchant candidate.");
    repository.updateCandidate(first.id, {
      accountId: "account-primary-bank",
      categoryId: "category-groceries",
      rememberMerchantRule: true,
    });
    repository.createArtifact({
      filename: "next.csv",
      contentHash: "merchant-rule-next",
      mimeType: "text/csv",
      sizeBytes: 100,
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-21",
          payee: "LOCAL TIFFIN SERVICE",
          amountPaise: 27500,
          direction: "debit",
          confidence: 55,
          warnings: [],
          source: {},
        },
      ],
    });
    expect(repository.getQueue().candidates.find((candidate) => candidate.filename === "next.csv")).toMatchObject({
      accountId: "account-primary-bank",
      categoryId: "category-groceries",
      warnings: expect.arrayContaining(["Merchant rule applied"]),
    });
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
