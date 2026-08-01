import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  budgetMonthResponseSchema,
  importArtifactSchema,
  importCandidateSchema,
  importQueueResponseSchema,
  statementUploadResponseSchema,
} from "@finance-hero/contracts";
import { afterEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { buildApp } from "./app";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

describe("statement import API", () => {
  it("uploads a CSV, edits review data, and bulk approves it", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-import-api-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-import-test-key-with-at-least-32-characters",
      },
    });
    const csv = [
      "Transaction Date,Narration,Debit Amount,Credit Amount",
      "20/07/2026,SWIGGY,1250,",
      "21/07/2026,MONTHLY SALARY,,300000",
    ].join("\n");
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=account.csv&accountId=account-primary-bank",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(csv),
    });
    expect(upload.statusCode).toBe(201);
    expect(statementUploadResponseSchema.parse(upload.json()).artifact.rowCount).toBe(2);

    const queueResponse = await app.inject({ method: "GET", url: "/api/v1/imports" });
    const queue = importQueueResponseSchema.parse(queueResponse.json());
    expect(queue.pendingCount).toBe(2);
    const expense = queue.candidates.find((candidate) => candidate.direction === "debit");
    expect(expense?.categoryId).toBe("category-groceries");

    const edit = await app.inject({
      method: "PATCH",
      url: `/api/v1/candidates/${expense?.id}`,
      payload: { payee: "Swiggy order" },
    });
    expect(edit.statusCode).toBe(200);
    expect(importCandidateSchema.parse(edit.json()).payee).toBe("Swiggy order");

    const approve = await app.inject({
      method: "POST",
      url: "/api/v1/candidate-actions/approve",
      payload: { ids: queue.candidates.map((candidate) => candidate.id) },
    });
    expect(approve.statusCode).toBe(200);
    expect(importQueueResponseSchema.parse(approve.json()).approvedCount).toBe(2);

    const reset = await app.inject({
      method: "POST",
      url: "/api/v1/candidate-actions/reset-pending",
      payload: { ids: [queue.candidates[0]?.id] },
    });
    expect(reset.statusCode).toBe(200);
    expect(importQueueResponseSchema.parse(reset.json())).toMatchObject({
      pendingCount: 1,
      approvedCount: 1,
    });

    const duplicate = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=renamed.csv&accountId=account-primary-bank",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(csv),
    });
    expect(duplicate.statusCode).toBe(200);
    expect(statementUploadResponseSchema.parse(duplicate.json()).duplicate).toBe(true);
    await app.close();
  });

  it("extracts, verifies, and applies a statement closing balance to the next month carryover", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-import-api-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-import-test-key-with-at-least-32-characters",
      },
    });
    const csv = [
      "Transaction Date,Narration,Debit Amount,Credit Amount,Balance",
      "10/07/2026,GROCERY STORE,1000,,9000",
      "12/07/2026,REFUND,,500,9500",
    ].join("\n");
    const upload = statementUploadResponseSchema.parse(
      (
        await app.inject({
          method: "POST",
          url: "/api/v1/statement-uploads?filename=reconcile.csv&accountId=account-primary-bank",
          headers: { "content-type": "application/octet-stream" },
          payload: Buffer.from(csv),
        })
      ).json(),
    );
    expect(upload.artifact.reconciliation).toMatchObject({
      status: "review_pending",
      periodStart: "2026-07-10",
      periodEnd: "2026-07-12",
      openingBalancePaise: 1000000,
      closingBalancePaise: 950000,
      extractionDifferencePaise: 0,
    });

    const queue = importQueueResponseSchema.parse((await app.inject({ method: "GET", url: "/api/v1/imports" })).json());
    const approve = await app.inject({
      method: "POST",
      url: "/api/v1/candidate-actions/approve",
      payload: { ids: queue.candidates.map((candidate) => candidate.id) },
    });
    expect(approve.statusCode).toBe(200);
    const readyQueue = importQueueResponseSchema.parse(approve.json());
    expect(readyQueue.artifacts[0]?.reconciliation).toMatchObject({ status: "ready", canReconcile: true });

    const reconcile = await app.inject({
      method: "POST",
      url: `/api/v1/imports/${upload.artifact.id}/reconcile`,
    });
    expect(reconcile.statusCode).toBe(200);
    expect(importArtifactSchema.parse(reconcile.json()).reconciliation.status).toBe("reconciled");

    const july = budgetMonthResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/v1/budgets/2026-07" })).json(),
    );
    const august = budgetMonthResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/api/v1/budgets/2026-08" })).json(),
    );
    expect(july.cashBridge).toMatchObject({
      statementBalancePaise: 950000,
      reconciledOn: "2026-07-12",
      closingBalancePaise: -19409200,
    });
    expect(august.cashBridge.carryoverPaise).toBe(-19409200);
    await app.close();
  });

  it("quarantines malformed PDFs without pretending they were parsed", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-import-api-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-import-test-key-with-at-least-32-characters",
      },
    });
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=statement.pdf",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("%PDF-1.7 redacted test"),
    });

    expect(upload.statusCode).toBe(201);
    expect(statementUploadResponseSchema.parse(upload.json()).artifact).toMatchObject({
      status: "failed",
      rowCount: 0,
    });
    await app.close();
  });

  it("extracts Excel transactions directly into the review queue", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-import-api-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-import-test-key-with-at-least-32-characters",
      },
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(
      workbook,
      XLSX.utils.aoa_to_sheet([
        ["Date", "Description", "Amount", "DR/CR"],
        ["20/07/2026", "APOLLO PHARMACY", 600, "DR"],
      ]),
      "Transactions",
    );
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=card.xlsx&accountId=account-primary-bank",
      headers: { "content-type": "application/octet-stream" },
      payload: XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer,
    });

    expect(upload.statusCode).toBe(201);
    expect(statementUploadResponseSchema.parse(upload.json()).artifact).toMatchObject({
      status: "parsed",
      rowCount: 1,
    });
    const queue = importQueueResponseSchema.parse((await app.inject({ method: "GET", url: "/api/v1/imports" })).json());
    expect(queue.candidates[0]).toMatchObject({
      payee: "APOLLO PHARMACY",
      amountPaise: 60000,
      categoryId: "category-medical",
    });
    await app.close();
  });

  it("retains an unparseable CSV as failed evidence instead of dropping it", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-import-api-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-import-test-key-with-at-least-32-characters",
      },
    });
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=unknown.csv",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from("A,B,C\n1,2,3"),
    });

    expect(upload.statusCode).toBe(201);
    expect(statementUploadResponseSchema.parse(upload.json()).artifact).toMatchObject({
      status: "failed",
      rowCount: 0,
    });
    await app.close();
  });

  it("uses category IDs that exist in the live foundation schema", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-import-api-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-import-test-key-with-at-least-32-characters",
      },
    });
    const csv = [
      "Transaction Date,Narration,Debit Amount,Credit Amount",
      "20/07/2026,AIRTEL BROADBAND,1250,",
      "21/07/2026,AMAZON SHOPPING,750,",
      "22/07/2026,NETFLIX SUBSCRIPTION,499,",
    ].join("\n");
    const upload = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=category-rules.csv&accountId=account-primary-bank",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(csv),
    });

    expect(upload.statusCode).toBe(201);
    const queue = importQueueResponseSchema.parse((await app.inject({ method: "GET", url: "/api/v1/imports" })).json());
    expect(Object.fromEntries(queue.candidates.map((candidate) => [candidate.payee, candidate.categoryId]))).toEqual({
      "AIRTEL BROADBAND": "category-utilities",
      "AMAZON SHOPPING": "category-personal",
      "NETFLIX SUBSCRIPTION": "category-learning",
    });
    await app.close();
  });

  it("holds semantic cross-file duplicates until the user resolves them", async () => {
    const dataDirectory = mkdtempSync(join(tmpdir(), "finance-hero-import-api-"));
    temporaryDirectories.push(dataDirectory);
    const app = await buildApp({
      config: {
        host: "127.0.0.1",
        port: 4317,
        dataDirectory,
        databaseKey: "server-import-test-key-with-at-least-32-characters",
      },
    });
    const firstUpload = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=bank.csv&accountId=account-primary-bank",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(
        ["Transaction Date,Narration,Debit Amount,Credit Amount", "20/07/2026,SWIGGY ORDER,1250,"].join("\n"),
      ),
    });
    expect(firstUpload.statusCode).toBe(201);

    const secondUpload = await app.inject({
      method: "POST",
      url: "/api/v1/statement-uploads?filename=card.csv&accountId=account-primary-bank",
      headers: { "content-type": "application/octet-stream" },
      payload: Buffer.from(["Date,Description,Debit,Credit", "21/07/2026,swiggy order,1250,"].join("\n")),
    });
    expect(secondUpload.statusCode).toBe(201);

    const queue = importQueueResponseSchema.parse((await app.inject({ method: "GET", url: "/api/v1/imports" })).json());
    const duplicate = queue.candidates.find((candidate) => candidate.duplicateResolution === "suspected");
    expect(duplicate).toMatchObject({
      duplicateConfidence: 92,
      duplicateFilename: "bank.csv",
    });

    const blockedApproval = await app.inject({
      method: "POST",
      url: "/api/v1/candidate-actions/approve",
      payload: { ids: [duplicate?.id] },
    });
    expect(blockedApproval.statusCode).toBe(400);

    const keepSeparate = await app.inject({
      method: "POST",
      url: `/api/v1/candidates/${duplicate?.id}/duplicate-resolution`,
      payload: { action: "keep_distinct" },
    });
    expect(keepSeparate.statusCode).toBe(200);
    const resolved = importQueueResponseSchema
      .parse(keepSeparate.json())
      .candidates.find((candidate) => candidate.id === duplicate?.id);
    expect(resolved?.duplicateResolution).toBe("distinct");

    const approval = await app.inject({
      method: "POST",
      url: "/api/v1/candidate-actions/approve",
      payload: { ids: [duplicate?.id] },
    });
    expect(approval.statusCode).toBe(200);
    await app.close();
  });
});
