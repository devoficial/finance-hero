import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BudgetRepository } from "./budget-repository";
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
  it("removes only empty Gmail artifacts and keeps imports with candidates or other sources", () => {
    const { database, repository } = createRepository();
    repository.createArtifact({
      filename: "unrelated.pdf",
      contentHash: "empty-gmail-hash",
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "needs_parser",
      parserMessage: "No transaction table was detected. Gmail message gmail-empty.",
      rows: [],
    });
    repository.createArtifact({
      filename: "manual.pdf",
      contentHash: "manual-empty-hash",
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "needs_parser",
      parserMessage: "No transaction table was detected.",
      rows: [],
    });
    repository.createArtifact({
      filename: "statement.csv",
      contentHash: "gmail-candidate-hash",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      parserMessage: "1 candidate extracted. Gmail message gmail-statement.",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-08-01",
          payee: "Grocer",
          amountPaise: 5000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });

    expect(repository.removeEmptyGmailArtifacts()).toEqual([
      expect.objectContaining({ filename: "unrelated.pdf", contentHash: "empty-gmail-hash" }),
    ]);
    const queue = repository.getQueue();
    expect(queue.artifacts.map((artifact) => artifact.filename)).toEqual(
      expect.arrayContaining(["manual.pdf", "statement.csv"]),
    );
    expect(queue.artifacts.map((artifact) => artifact.filename)).not.toContain("unrelated.pdf");
    expect(queue.candidates).toHaveLength(1);
    database.close();
  });

  it("rejects a source and all of its pending candidates while retaining the artifact", () => {
    const { database, repository } = createRepository();
    const created = repository.createArtifact({
      filename: "protected.pdf",
      contentHash: "source-reject-hash",
      mimeType: "application/pdf",
      sizeBytes: 192000,
      status: "needs_parser",
      parserMessage: "This PDF is password protected.",
      rows: [
        {
          sourceRow: 1,
          occurredOn: "2026-08-01",
          payee: "Detected merchant",
          amountPaise: 10000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });

    expect(repository.rejectArtifact(created.artifact.id)).toMatchObject({
      id: created.artifact.id,
      pendingCount: 0,
      rejectedCount: 1,
      parserMessage: expect.stringMatching(/^Source statement rejected\./),
    });
    expect(repository.getQueue().candidates[0]).toMatchObject({
      status: "rejected",
      rejectionReason: "Source statement rejected",
    });
    database.close();
  });

  it("permanently deletes an unposted source and its candidates", () => {
    const { database, repository } = createRepository();
    const created = repository.createArtifact({
      filename: "delete-me.pdf",
      contentHash: "source-delete-hash",
      mimeType: "application/pdf",
      sizeBytes: 192000,
      status: "needs_parser",
      rows: [],
    });

    expect(repository.deleteArtifact(created.artifact.id)).toMatchObject({
      id: created.artifact.id,
      filename: "delete-me.pdf",
      contentHash: "source-delete-hash",
    });
    expect(repository.getQueue().artifacts).toHaveLength(0);
    expect(() => repository.deleteArtifact(created.artifact.id)).toThrow("Statement artifact does not exist.");
    database.close();
  });

  it("permanently deletes multiple unposted sources in one operation", () => {
    const { database, repository } = createRepository();
    const first = repository.createArtifact({
      filename: "first.pdf",
      contentHash: "bulk-delete-first-hash",
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "needs_parser",
      rows: [],
    });
    const second = repository.createArtifact({
      filename: "second.pdf",
      contentHash: "bulk-delete-second-hash",
      mimeType: "application/pdf",
      sizeBytes: 200,
      status: "needs_parser",
      rows: [],
    });

    expect(repository.deleteArtifacts([first.artifact.id, second.artifact.id])).toEqual([
      expect.objectContaining({ id: first.artifact.id, filename: "first.pdf" }),
      expect.objectContaining({ id: second.artifact.id, filename: "second.pdf" }),
    ]);
    expect(repository.getQueue().artifacts).toHaveLength(0);
    database.close();
  });

  it("keeps every selected source when a bulk deletion contains a posted source", () => {
    const { database, repository } = createRepository();
    const unposted = repository.createArtifact({
      filename: "unposted.pdf",
      contentHash: "bulk-atomic-unposted-hash",
      mimeType: "application/pdf",
      sizeBytes: 100,
      status: "needs_parser",
      rows: [],
    });
    const posted = repository.createArtifact({
      filename: "posted.csv",
      contentHash: "bulk-atomic-posted-hash",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-08-01",
          payee: "Grocer",
          amountPaise: 5000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected posted candidate.");
    repository.approveCandidates([candidate.id]);

    expect(() => repository.deleteArtifacts([unposted.artifact.id, posted.artifact.id])).toThrow(
      "A statement with posted transactions cannot be deleted.",
    );
    expect(repository.getQueue().artifacts.map((artifact) => artifact.id)).toEqual(
      expect.arrayContaining([unposted.artifact.id, posted.artifact.id]),
    );
    database.close();
  });

  it("protects sources that already have posted transactions from rejection and deletion", () => {
    const { database, repository } = createRepository();
    const created = repository.createArtifact({
      filename: "posted.csv",
      contentHash: "posted-source-hash",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-08-01",
          payee: "Grocer",
          amountPaise: 5000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected posted candidate.");
    repository.approveCandidates([candidate.id]);

    expect(() => repository.rejectArtifact(created.artifact.id)).toThrow(
      "A statement with posted transactions cannot be rejected.",
    );
    expect(() => repository.deleteArtifact(created.artifact.id)).toThrow(
      "A statement with posted transactions cannot be deleted.",
    );
    database.close();
  });

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

  it("refreshes missing statement balance metadata on a duplicate upload without replacing posted rows", () => {
    const { database, repository } = createRepository();
    const input = {
      filename: "bank.csv",
      contentHash: "legacy-parser-hash",
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

    const created = repository.createArtifact(input);
    const candidateId = repository.getQueue().candidates[0]?.id ?? "";
    repository.approveCandidates([candidateId]);

    const duplicate = repository.createArtifact({
      ...input,
      parserMessage: "1 transaction candidate extracted with statement balances.",
      reconciliation: {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        openingBalanceAssetPaise: 100000,
        openingBalanceLiabilityPaise: null,
        closingBalancePaise: 57500,
      },
    });

    expect(duplicate).toMatchObject({
      duplicate: true,
      artifact: {
        id: created.artifact.id,
        approvedCount: 1,
        pendingCount: 0,
        reconciliation: {
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          openingBalancePaise: 100000,
          closingBalancePaise: 57500,
          status: "ready",
          canReconcile: true,
        },
      },
    });
    expect(repository.getQueue().candidates).toHaveLength(1);
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

  it("adds approved EMI and insurance rows to a live expense sheet", () => {
    const { database, repository } = createRepository();
    const budgets = new BudgetRepository(database);
    budgets.updateMonth("2026-08", {
      lines: [
        { categoryId: "category-emi-payments", actualPaise: 100000 },
        { categoryId: "category-insurance", actualPaise: 50000 },
      ],
    });
    repository.createArtifact({
      filename: "august-statement.csv",
      contentHash: "august-emi-insurance",
      mimeType: "text/csv",
      sizeBytes: 180,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-08-02",
          payee: "Loan EMI",
          amountPaise: 20000,
          direction: "debit",
          categoryId: "category-emi-payments",
          confidence: 90,
          warnings: [],
          source: {},
        },
        {
          sourceRow: 3,
          occurredOn: "2026-08-02",
          payee: "Insurance premium",
          amountPaise: 30000,
          direction: "debit",
          categoryId: "category-insurance",
          confidence: 90,
          warnings: [],
          source: {},
        },
      ],
    });
    const candidates = repository.getQueue().candidates;

    repository.approveCandidates(candidates.map((candidate) => candidate.id));

    const august = budgets.getMonth("2026-08");
    expect(august.lines.find((line) => line.categoryId === "category-emi-payments")?.spentPaise).toBe(120000);
    expect(august.lines.find((line) => line.categoryId === "category-insurance")?.spentPaise).toBe(80000);
    database.close();
  });

  it("never makes a monthly aggregate negative and restores the exact baseline on reset", () => {
    const { database, ledger, repository } = createRepository();
    const aggregateId = "migration-expense-history-2026-06-category-groceries";
    const postings = database.connection
      .prepare("SELECT id, amount_paise AS amountPaise FROM postings WHERE transaction_id = ? ORDER BY amount_paise")
      .all(aggregateId) as Array<{ id: string; amountPaise: number }>;
    expect(postings).toHaveLength(2);
    for (const posting of postings) {
      database.connection
        .prepare("UPDATE postings SET amount_paise = ? WHERE id = ?")
        .run(posting.amountPaise < 0 ? -10000 : 10000, posting.id);
    }
    const before = ledger.getDashboard("2026-06", 30);
    repository.createArtifact({
      filename: "aggregate-overrun.csv",
      contentHash: "aggregate-overrun",
      mimeType: "text/csv",
      sizeBytes: 100,
      accountId: "account-primary-bank",
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-06-15",
          payee: "Synthetic grocery detail",
          amountPaise: 15000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: { Description: "Synthetic grocery detail" },
        },
      ],
    });
    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected aggregate overrun candidate.");

    const approved = repository.approveCandidates([candidate.id]);

    expect(ledger.getDashboard("2026-06", 30).regularExpensePaise).toBe(before.regularExpensePaise + 5000);
    expect(
      database.connection
        .prepare("SELECT COUNT(*) AS count FROM postings WHERE transaction_id = ? AND amount_paise < 0")
        .get(aggregateId),
    ).toEqual({ count: 1 });
    expect(
      database.connection.prepare("SELECT status FROM journal_transactions WHERE id = ?").get(aggregateId),
    ).toEqual({ status: "reversed" });
    expect(approved.candidates.find((item) => item.id === candidate.id)?.source).toEqual({
      Description: "Synthetic grocery detail",
    });

    repository.resetCandidatesToPending([candidate.id]);

    expect(ledger.getDashboard("2026-06", 30).regularExpensePaise).toBe(before.regularExpensePaise);
    expect(
      database.connection.prepare("SELECT status FROM journal_transactions WHERE id = ?").get(aggregateId),
    ).toEqual({ status: "posted" });
    expect(
      database.connection
        .prepare("SELECT amount_paise AS amountPaise FROM postings WHERE transaction_id = ? ORDER BY amount_paise")
        .all(aggregateId),
    ).toEqual([{ amountPaise: -10000 }, { amountPaise: 10000 }]);
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

  it("prevents a repeated upload after the canonical row is already approved", () => {
    const { database, ledger, repository } = createRepository();
    const base = {
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed" as const,
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-20",
          payee: "UPI/P2M/123456789/SYNTHETIC CAFE PAYMENT",
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
      filename: "first.pdf",
      contentHash: "approved-duplicate-pdf",
      mimeType: "application/pdf",
    });
    const canonical = repository.getQueue().candidates[0];
    if (!canonical) throw new Error("Expected canonical candidate.");
    repository.approveCandidates([canonical.id]);
    const postedBefore = ledger.listTransactions("2026-07").filter((item) => item.payee.includes("SYNTHETIC CAFE"));

    repository.createArtifact({
      ...base,
      filename: "repeat.csv",
      contentHash: "approved-duplicate-csv",
      mimeType: "text/csv",
    });
    const repeated = repository
      .getQueue()
      .candidates.find((candidate) => candidate.id !== canonical.id && candidate.status === "pending");

    expect(repeated).toMatchObject({ duplicateResolution: "suspected", duplicateOfCandidateId: canonical.id });
    expect(() => repository.approveCandidates([repeated?.id ?? ""])).toThrow("matches an existing transaction");
    repository.resolveDuplicate(repeated?.id ?? "", "merge");
    expect(ledger.listTransactions("2026-07").filter((item) => item.payee.includes("SYNTHETIC CAFE"))).toHaveLength(
      postedBefore.length,
    );
    database.close();
  });

  it("rechecks a distinct decision whenever statement reconciliation changes the account", () => {
    const { database, repository } = createRepository();
    const create = (filename: string, hash: string) =>
      repository.createArtifact({
        filename,
        contentHash: hash,
        mimeType: "text/csv",
        sizeBytes: 100,
        accountId: "account-savings",
        status: "parsed",
        rows: [
          {
            sourceRow: 2,
            occurredOn: "2026-07-20",
            payee: "SYNTHETIC TRANSFER",
            amountPaise: 5000,
            direction: "debit",
            categoryId: "category-transport",
            confidence: 85,
            warnings: [],
            source: {},
          },
        ],
      });
    create("first.csv", "reconcile-duplicate-first");
    const secondArtifact = create("second.csv", "reconcile-duplicate-second").artifact;
    const second = repository.getQueue().candidates.find((candidate) => candidate.artifactId === secondArtifact.id);
    repository.resolveDuplicate(second?.id ?? "", "keep_distinct");

    repository.updateStatementReconciliation(secondArtifact.id, {
      accountId: "account-primary-bank",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      openingBalancePaise: 100000,
      closingBalancePaise: 95000,
    });
    expect(repository.getQueue().candidates.find((candidate) => candidate.id === second?.id)).toMatchObject({
      duplicateResolution: "none",
      duplicateOfCandidateId: null,
    });

    repository.updateStatementReconciliation(secondArtifact.id, {
      accountId: "account-savings",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      openingBalancePaise: 100000,
      closingBalancePaise: 95000,
    });
    expect(repository.getQueue().candidates.find((candidate) => candidate.id === second?.id)).toMatchObject({
      duplicateResolution: "suspected",
    });
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
    // Groceries only had Rs 568 in the migrated aggregate, so the extra Rs 132
    // from the detailed split is real new spending rather than a negative aggregate.
    expect(ledger.getDashboard("2026-07", 31).regularExpensePaise).toBe(before.regularExpensePaise + 13200);
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

  it("reconciles approved statement movement and makes the closing balance authoritative", () => {
    const { database, repository } = createRepository();
    const created = repository.createArtifact({
      filename: "july-bank.csv",
      contentHash: "statement-reconciliation-ready",
      mimeType: "text/csv",
      sizeBytes: 200,
      accountId: "account-primary-bank",
      status: "parsed",
      reconciliation: {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        openingBalanceAssetPaise: 1000000,
        openingBalanceLiabilityPaise: 800000,
        closingBalancePaise: 950000,
      },
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-10",
          payee: "Grocery purchase",
          amountPaise: 100000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
        {
          sourceRow: 3,
          occurredOn: "2026-07-12",
          payee: "Refund",
          amountPaise: 50000,
          direction: "credit",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });

    expect(created.artifact.reconciliation).toMatchObject({
      status: "review_pending",
      extractedMovementPaise: -50000,
      extractionDifferencePaise: 0,
      pendingCount: 2,
    });

    repository.approveCandidates(repository.getQueue().candidates.map((candidate) => candidate.id));
    expect(
      repository.getQueue().artifacts.find((artifact) => artifact.id === created.artifact.id)?.reconciliation,
    ).toMatchObject({
      status: "ready",
      recognizedMovementPaise: -50000,
      expectedClosingBalancePaise: 950000,
      ledgerDifferencePaise: 0,
      canReconcile: true,
    });

    expect(repository.reconcileStatement(created.artifact.id).reconciliation).toMatchObject({
      status: "reconciled",
      reconciledAt: expect.any(String),
    });
    expect(
      database.connection
        .prepare(`
          SELECT month, account_id AS accountId, statement_balance_paise AS statementBalancePaise,
                 reconciled_on AS reconciledOn
          FROM monthly_bank_reconciliations
          WHERE month = '2026-07'
        `)
        .get(),
    ).toEqual({
      month: "2026-07",
      accountId: "account-primary-bank",
      statementBalancePaise: 950000,
      reconciledOn: "2026-07-31",
    });
    expect(
      database.connection
        .prepare(`
          SELECT month, amount_paise AS amountPaise, source_ref AS sourceRef
          FROM monthly_cash_carryover_overrides
          WHERE month = '2026-07'
        `)
        .get(),
    ).toEqual({
      month: "2026-07",
      amountPaise: 1000000,
      sourceRef: `statement:${created.artifact.id}`,
    });
    database.close();
  });

  it("blocks reconciliation when rejected rows leave the approved record short", () => {
    const { database, repository } = createRepository();
    const created = repository.createArtifact({
      filename: "unmatched-bank.csv",
      contentHash: "statement-reconciliation-mismatch",
      mimeType: "text/csv",
      sizeBytes: 120,
      accountId: "account-primary-bank",
      status: "parsed",
      reconciliation: {
        periodStart: "2026-07-01",
        periodEnd: "2026-07-31",
        openingBalanceAssetPaise: 1000000,
        openingBalanceLiabilityPaise: 800000,
        closingBalancePaise: 900000,
      },
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-10",
          payee: "Unrecognized debit",
          amountPaise: 100000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    const candidate = repository.getQueue().candidates[0];
    if (!candidate) throw new Error("Expected reconciliation candidate.");

    repository.rejectCandidates([candidate.id], "Needs investigation");
    expect(
      repository.getQueue().artifacts.find((artifact) => artifact.id === created.artifact.id)?.reconciliation,
    ).toMatchObject({
      status: "ledger_mismatch",
      extractionDifferencePaise: 0,
      ledgerDifferencePaise: -100000,
      rejectedCount: 1,
      canReconcile: false,
    });
    expect(() => repository.reconcileStatement(created.artifact.id)).toThrow(
      "Resolve the statement review and balance differences",
    );
    database.close();
  });

  it("allows corrected statement metadata and propagates the selected account to pending rows", () => {
    const { database, repository } = createRepository();
    const created = repository.createArtifact({
      filename: "manual-balance.csv",
      contentHash: "statement-reconciliation-manual",
      mimeType: "text/csv",
      sizeBytes: 90,
      status: "parsed",
      rows: [
        {
          sourceRow: 2,
          occurredOn: "2026-07-10",
          payee: "Coffee",
          amountPaise: 50000,
          direction: "debit",
          categoryId: "category-groceries",
          confidence: 85,
          warnings: [],
          source: {},
        },
      ],
    });
    expect(created.artifact.reconciliation.status).toBe("account_required");

    const updated = repository.updateStatementReconciliation(created.artifact.id, {
      accountId: "account-primary-bank",
      periodStart: "2026-07-01",
      periodEnd: "2026-07-31",
      openingBalancePaise: 1000000,
      closingBalancePaise: 950000,
    });
    expect(updated.reconciliation).toMatchObject({
      status: "review_pending",
      openingBalancePaise: 1000000,
      closingBalancePaise: 950000,
      extractionDifferencePaise: 0,
    });
    expect(repository.getQueue().candidates[0]?.accountId).toBe("account-primary-bank");
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
