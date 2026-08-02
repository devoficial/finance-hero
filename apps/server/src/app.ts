import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
  assistantChatRequestSchema,
  assistantChatResponseSchema,
  assistantConversationSchema,
  assistantStatusResponseSchema,
  budgetMonthResponseSchema,
  createFinancialAccountRequestSchema,
  createFinancialGoalRequestSchema,
  createLiabilityRequestSchema,
  createManualTransactionRequestSchema,
  createPersonalBalanceRequestSchema,
  createProjectCommitmentRequestSchema,
  createProjectExpenseRequestSchema,
  createWealthAssetRequestSchema,
  dashboardResponseSchema,
  expenseYearResponseSchema,
  financialAccountSchema,
  financialAccountsResponseSchema,
  financialGoalSchema,
  healthResponseSchema,
  importArtifactSchema,
  importCandidateActionRequestSchema,
  importCandidateSchema,
  importQueueResponseSchema,
  ledgerResponseSchema,
  ledgerTransactionSchema,
  liabilitiesResponseSchema,
  liabilitySchema,
  monthSchema,
  personalBalanceSchema,
  projectCommitmentSchema,
  projectExpenseSchema,
  projectSummaryResponseSchema,
  referenceDataResponseSchema,
  rejectImportCandidatesRequestSchema,
  replaceTransactionRequestSchema,
  resolveImportDuplicateRequestSchema,
  reverseTransactionRequestSchema,
  statementParseRequestSchema,
  statementUploadResponseSchema,
  updateBudgetMonthRequestSchema,
  updateFinancialAccountRequestSchema,
  updateFinancialGoalRequestSchema,
  updateGoalAllocationsRequestSchema,
  updateImportCandidateRequestSchema,
  updateLiabilityRequestSchema,
  updatePersonalBalanceRequestSchema,
  updateProjectCommitmentRequestSchema,
  updateProjectExpenseRequestSchema,
  updateStatementReconciliationRequestSchema,
  updateWealthAssetRequestSchema,
  wealthAssetSchema,
  wealthResponseSchema,
  yearSchema,
} from "@finance-hero/contracts";
import {
  AccountRepository,
  AssistantRepository,
  BudgetRepository,
  createVerifiedEncryptedBackup,
  type FinanceHeroDatabase,
  foundationSchemaNeedsMigration,
  ImportRepository,
  initializeFoundationSchema,
  LedgerRepository,
  openEncryptedDatabase,
  ProjectRepository,
  seedAcceptedOpeningSnapshot,
  WealthRepository,
} from "@finance-hero/database";
import Fastify, { type FastifyInstance } from "fastify";
import { AssistantService } from "./assistant-service";
import type { ServerConfig } from "./config";
import { DevicePairingService } from "./device-pairing-service";
import { type GmailConnector, GmailService } from "./gmail-service";
import { type IosMessageInput, parseIosMessage } from "./ios-message-parser";
import { parseScannedPdfWithLocalOcr } from "./local-ocr";
import {
  type ParsedStatementReconciliation,
  type ParsedStatementRow,
  parseStatementDelimitedFile,
  parseStatementExcelFile,
  parseStatementPdfFile,
  StatementPasswordRequiredError,
} from "./statement-parser";

export interface BuildAppOptions {
  config: ServerConfig;
  version?: string;
  logger?: boolean;
  gmailService?: GmailConnector;
}

const MAX_STATEMENT_BYTES = 10 * 1024 * 1024;

function isValidStatementFilename(filename: string): boolean {
  return Boolean(filename) && filename.length <= 240 && !filename.includes("/") && !filename.includes("\\");
}

const CATEGORY_RULES: Array<{ categoryId: string; terms: string[] }> = [
  {
    categoryId: "category-groceries",
    terms: ["swiggy", "zomato", "blinkit", "zepto", "bigbasket", "grocery", "supermarket", "restaurant", "cafe"],
  },
  {
    categoryId: "category-transport",
    terms: ["uber", "ola", "rapido", "petrol", "fuel", "irctc", "airlines", "metro"],
  },
  {
    categoryId: "category-personal",
    terms: ["amazon", "flipkart", "myntra", "ajio", "shopping", "decathlon"],
  },
  {
    categoryId: "category-learning",
    terms: ["netflix", "spotify", "hotstar", "prime video", "bookmyshow", "subscription"],
  },
  {
    categoryId: "category-medical",
    terms: ["pharmacy", "apollo", "hospital", "clinic", "medical", "diagnostic"],
  },
  {
    categoryId: "category-utilities",
    terms: ["airtel", "jio", "broadband", "electricity", "bescom"],
  },
];

function suggestCategoryId(payee: string): string | undefined {
  const normalized = payee.toLowerCase();
  return CATEGORY_RULES.find((rule) => rule.terms.some((term) => normalized.includes(term)))?.categoryId;
}

function detectStatementType(content: Buffer, extension: string): "csv" | "tsv" | "pdf" | "xls" | "xlsx" | "unknown" {
  if (content.subarray(0, 5).toString("ascii") === "%PDF-") return "pdf";
  if (content.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0]))) return "xls";
  if (content.subarray(0, 2).toString("ascii") === "PK") return "xlsx";
  if ((extension === "csv" || extension === "tsv") && !content.includes(0)) return extension;
  return "unknown";
}

function statementMimeType(fileType: string): string {
  if (fileType === "csv") return "text/csv";
  if (fileType === "tsv") return "text/tab-separated-values";
  if (fileType === "pdf") return "application/pdf";
  if (fileType === "xls") return "application/vnd.ms-excel";
  if (fileType === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

function statementFileTypeFromMime(mimeType: string): "csv" | "tsv" | "pdf" | "xls" | "xlsx" | "unknown" {
  if (mimeType === "text/csv") return "csv";
  if (mimeType === "text/tab-separated-values") return "tsv";
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "application/vnd.ms-excel") return "xls";
  if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") return "xlsx";
  return "unknown";
}

function prepareImportRows(rows: ParsedStatementRow[]) {
  return rows.map((row) => {
    const categoryId = row.direction === "debit" ? suggestCategoryId(row.payee) : undefined;
    return {
      ...row,
      categoryId,
      confidence: categoryId ? row.confidence : Math.min(row.confidence, 60),
      warnings:
        row.direction === "debit" && !categoryId ? [...row.warnings, "Choose an expense category"] : row.warnings,
    };
  });
}

async function parseStatementContent(
  content: Buffer,
  fileType: "csv" | "tsv" | "pdf" | "xls" | "xlsx" | "unknown",
  filename: string,
  password?: string,
) {
  if (fileType === "csv" || fileType === "tsv") {
    return parseStatementDelimitedFile(content, `statement.${fileType}`);
  }
  if (fileType === "pdf") {
    return parseStatementPdfFile(content, password);
  }
  if (fileType === "xls" || fileType === "xlsx") {
    return parseStatementExcelFile(content, filename);
  }
  throw new Error("Unsupported file type. Upload CSV, TSV, PDF, XLS, or XLSX.");
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: 10 * 1024 * 1024 });
  let database: FinanceHeroDatabase | undefined;
  let budgets: BudgetRepository | undefined;
  let accounts: AccountRepository | undefined;
  let ledger: LedgerRepository | undefined;
  let imports: ImportRepository | undefined;
  let projects: ProjectRepository | undefined;
  let wealth: WealthRepository | undefined;
  let assistant: AssistantService | undefined;
  const gmail = options.gmailService ?? new GmailService(options.config);
  const devices = new DevicePairingService(options.config.dataDirectory);
  let backupBeforeRisk: ((reason: string) => void) | undefined;

  if (options.config.databaseKey) {
    mkdirSync(options.config.dataDirectory, { recursive: true, mode: 0o700 });
    const databasePath = join(options.config.dataDirectory, "finance-hero.db");
    const databaseExisted = existsSync(databasePath) && statSync(databasePath).size > 0;
    const databaseKey = Buffer.from(options.config.databaseKey, "utf8");
    database = openEncryptedDatabase(databasePath, databaseKey);
    backupBeforeRisk = (reason) => {
      createVerifiedEncryptedBackup({
        database: database as FinanceHeroDatabase,
        databasePath,
        key: databaseKey,
        backupDirectory: join(options.config.dataDirectory, "backups", "automatic"),
        reason,
      });
    };
    if (databaseExisted && foundationSchemaNeedsMigration(database)) {
      backupBeforeRisk("before-schema-migration");
    }
    initializeFoundationSchema(database);
    seedAcceptedOpeningSnapshot(database);
    ledger = new LedgerRepository(database);
    imports = new ImportRepository(database, ledger);
    accounts = new AccountRepository(database);
    budgets = new BudgetRepository(database);
    projects = new ProjectRepository(database, ledger);
    wealth = new WealthRepository(database);
    assistant = new AssistantService({
      config: options.config,
      assistant: new AssistantRepository(database),
      accounts,
      budgets,
      ledger,
      wealth,
    });
  }

  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: 10 * 1024 * 1024 },
    (_request, body, done) => done(null, body),
  );

  app.get("/api/v1/health", async (_request, reply) => {
    const payload = healthResponseSchema.parse({
      service: "finance-hero",
      status: database ? "ok" : "degraded",
      version: options.version ?? "0.1.0",
      database: database ? "encrypted" : "not-configured",
      checkedAt: new Date().toISOString(),
    });

    return reply.header("cache-control", "no-store").send(payload);
  });

  app.get("/api/v1/gmail/status", async (_request, reply) => {
    return reply.header("cache-control", "no-store").send(await gmail.status());
  });

  app.get("/api/v1/gmail/oauth/start", async (_request, reply) => {
    try {
      return reply.redirect(gmail.createAuthorizationUrl());
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail OAuth could not start.";
      return reply.code(503).send({ error: { code: "GMAIL_NOT_CONFIGURED", message } });
    }
  });

  app.get("/api/v1/gmail/oauth/callback", async (request, reply) => {
    try {
      const query = request.query as { code?: string; state?: string; error?: string };
      if (query.error) throw new Error(`Google authorization was declined (${query.error}).`);
      if (!query.code || !query.state) throw new Error("Google did not return a valid authorization response.");
      await gmail.completeAuthorization(query.code, query.state);
      return reply.redirect("http://127.0.0.1:4318/#/imports?gmail=connected");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail OAuth could not be completed.";
      return reply.code(400).send({ error: { code: "GMAIL_OAUTH_FAILED", message } });
    }
  });

  app.post("/api/v1/gmail/discover", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const input = (request.body ?? {}) as { query?: string; maxMessages?: number };
      const query = typeof input.query === "string" && input.query.trim() ? input.query.trim() : undefined;
      const maxMessages = Number.isInteger(input.maxMessages) ? input.maxMessages : undefined;
      const attachments = await gmail.discoverAttachments(query, maxMessages);
      let imported = 0;
      let duplicates = 0;
      let needsAttention = 0;
      let failed = 0;
      for (const attachment of attachments) {
        if (!isValidStatementFilename(attachment.filename) || attachment.content.length > MAX_STATEMENT_BYTES) {
          failed += 1;
          continue;
        }
        const contentHash = createHash("sha256").update(attachment.content).digest("hex");
        const extension = attachment.filename.toLowerCase().split(".").pop() ?? "";
        const fileType = detectStatementType(attachment.content, extension);
        let rows: ReturnType<typeof prepareImportRows> = [];
        let reconciliation: ParsedStatementReconciliation | undefined;
        let status: "parsed" | "needs_parser" | "failed" = "failed";
        let parserMessage = "Unsupported Gmail attachment type.";
        if (fileType !== "unknown") {
          try {
            const parsed = await parseStatementContent(attachment.content, fileType, attachment.filename);
            rows = prepareImportRows(parsed.rows);
            reconciliation = parsed.reconciliation;
            status = "parsed";
            parserMessage = parsed.message;
          } catch (error) {
            const message = error instanceof Error ? error.message : "Gmail attachment could not be parsed.";
            status =
              error instanceof StatementPasswordRequiredError || message.includes("OCR is required")
                ? "needs_parser"
                : "failed";
            parserMessage = message;
          }
        }
        const quarantineDirectory = join(options.config.dataDirectory, "imports", "quarantine");
        mkdirSync(quarantineDirectory, { recursive: true, mode: 0o700 });
        const quarantinePath = join(quarantineDirectory, `${contentHash}.${fileType === "unknown" ? "bin" : fileType}`);
        writeFileSync(quarantinePath, attachment.content, { mode: 0o600 });
        chmodSync(quarantinePath, 0o600);
        const result = imports.createArtifact({
          filename: attachment.filename,
          contentHash,
          mimeType: statementMimeType(fileType),
          sizeBytes: attachment.content.length,
          status,
          parserMessage: `${parserMessage} Gmail message ${attachment.messageId}.`,
          reconciliation,
          rows,
        });
        if (result.duplicate) {
          duplicates += 1;
        } else {
          imported += 1;
          if (status === "needs_parser") needsAttention += 1;
          if (status === "failed") failed += 1;
        }
      }
      return reply.send({ attachmentsFound: attachments.length, imported, duplicates, needsAttention, failed });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Gmail discovery failed.";
      return reply.code(400).send({ error: { code: "GMAIL_DISCOVERY_FAILED", message } });
    }
  });

  app.post("/api/v1/gmail/cleanup-empty-artifacts", async (_request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    backupBeforeRisk?.("before-gmail-empty-artifact-cleanup");
    const removed = imports.removeEmptyGmailArtifacts();
    const quarantineDirectory = join(options.config.dataDirectory, "imports", "quarantine");
    let filesRemoved = 0;
    if (existsSync(quarantineDirectory)) {
      const filenames = readdirSync(quarantineDirectory);
      for (const artifact of removed) {
        for (const filename of filenames) {
          if (!filename.startsWith(`${artifact.contentHash}.`)) continue;
          const quarantinePath = join(quarantineDirectory, filename);
          if (existsSync(quarantinePath)) {
            unlinkSync(quarantinePath);
            filesRemoved += 1;
          }
        }
      }
    }

    return reply.send({ removed: removed.length, filesRemoved });
  });

  app.post("/api/v1/devices/pairing-code", async (_request, reply) => {
    return reply.header("cache-control", "no-store").send(devices.createPairingCode());
  });

  app.post("/api/v1/devices/pair", async (request, reply) => {
    try {
      const input = (request.body ?? {}) as { code?: string; name?: string };
      if (!input.code || !input.name) throw new Error("Pairing code and device name are required.");
      return reply.send(devices.pair(input.code, input.name));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Device pairing failed.";
      return reply.code(400).send({ error: { code: "PAIRING_FAILED", message } });
    }
  });

  app.get("/api/v1/devices", async (_request, reply) => {
    return reply.header("cache-control", "no-store").send({ devices: devices.list() });
  });

  app.delete("/api/v1/devices/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    return devices.revoke(id)
      ? reply.code(204).send()
      : reply.code(404).send({ error: { code: "NOT_FOUND", message: "Paired device does not exist." } });
  });

  app.post("/api/v1/import-hooks/ios-message", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    const authorization = request.headers.authorization ?? "";
    const token = authorization.startsWith("Bearer ") ? authorization.slice(7).trim() : "";
    if (!token || !devices.authenticate(token)) {
      return reply
        .code(401)
        .send({ error: { code: "UNAUTHORIZED", message: "Pair this iPhone before importing messages." } });
    }
    try {
      const input = (request.body ?? {}) as IosMessageInput;
      const parsed = parseIosMessage(input);
      const suggestedCategory = parsed.row.direction === "debit" ? suggestCategoryId(parsed.row.payee) : undefined;
      const row = {
        ...parsed.row,
        categoryId: suggestedCategory,
        confidence: suggestedCategory ? parsed.row.confidence : Math.min(parsed.row.confidence, 60),
        warnings: suggestedCategory ? parsed.row.warnings : [...parsed.row.warnings, "Choose an expense category"],
        source: Object.fromEntries(
          Object.entries(parsed.row.source).map(([key, value]) => [key, value == null ? "" : String(value)]),
        ),
      };
      const evidence = Buffer.from(JSON.stringify(input));
      const quarantineDirectory = join(options.config.dataDirectory, "imports", "quarantine");
      mkdirSync(quarantineDirectory, { recursive: true, mode: 0o700 });
      const quarantinePath = join(quarantineDirectory, `${parsed.contentHash}.json`);
      writeFileSync(quarantinePath, evidence, { mode: 0o600 });
      chmodSync(quarantinePath, 0o600);
      const result = imports.createArtifact({
        filename: parsed.filename,
        contentHash: parsed.contentHash,
        mimeType: "application/json",
        sizeBytes: evidence.length,
        accountId: parsed.accountId,
        status: "parsed",
        parserMessage: "Imported from a paired iPhone Shortcut. Review is required before posting.",
        rows: [row],
      });
      return reply.code(result.duplicate ? 200 : 201).send(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : "iPhone message import failed.";
      return reply.code(400).send({ error: { code: "IOS_IMPORT_FAILED", message } });
    }
  });

  app.get("/api/v1/assistant/status", async (_request, reply) => {
    const status = assistant
      ? await assistant.status()
      : {
          available: false,
          model: options.config.ollamaModel ?? "qwen3:4b-thinking-2507-q4_K_M",
          localOnly: true as const,
          readOnly: true as const,
          message: "Unlock the encrypted database to use the local assistant.",
        };
    return reply.header("cache-control", "no-store").send(assistantStatusResponseSchema.parse(status));
  });

  app.get("/api/v1/assistant/conversations/:id", async (request, reply) => {
    if (!assistant) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    const { id } = request.params as { id: string };
    const conversation = assistant.getConversation(id);
    if (!conversation) {
      return reply.code(404).send({ error: { code: "NOT_FOUND", message: "Conversation does not exist." } });
    }
    return reply.header("cache-control", "no-store").send(assistantConversationSchema.parse(conversation));
  });

  app.post("/api/v1/assistant/chat", async (request, reply) => {
    if (!assistant) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const input = assistantChatRequestSchema.parse(request.body);
      const response = await assistant.chat(input);
      return reply.header("cache-control", "no-store").send(assistantChatResponseSchema.parse(response));
    } catch (error) {
      const message = error instanceof Error ? error.message : "The local assistant could not answer.";
      return reply.code(502).send({ error: { code: "LOCAL_MODEL_UNAVAILABLE", message } });
    }
  });

  app.get("/api/v1/dashboard", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    const query = request.query as { month?: string };
    const month = monthSchema.parse(query.month ?? "2026-07");
    const now = new Date();
    const localMonth = new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      month: "2-digit",
      timeZone: "Asia/Kolkata",
    }).format(now);
    const localDay =
      month === localMonth
        ? Number(new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }).format(now))
        : 31;
    return reply
      .header("cache-control", "no-store")
      .send(dashboardResponseSchema.parse(ledger.getDashboard(month, localDay)));
  });

  app.get("/api/v1/ledger", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    const query = request.query as { month?: string };
    const month = monthSchema.parse(query.month ?? "2026-07");
    return reply.header("cache-control", "no-store").send(
      ledgerResponseSchema.parse({
        month,
        transactions: ledger.listTransactions(month),
      }),
    );
  });

  app.get("/api/v1/expenses/year", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    const query = request.query as { year?: string };
    const year = yearSchema.parse(query.year ?? "2026");
    return reply.header("cache-control", "no-store").send(expenseYearResponseSchema.parse(ledger.getExpenseYear(year)));
  });

  app.get("/api/v1/liabilities", async (_request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    return reply.header("cache-control", "no-store").send(liabilitiesResponseSchema.parse(ledger.getLiabilities()));
  });

  app.post("/api/v1/liabilities", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createLiabilityRequestSchema.parse(request.body);
      return reply.code(201).send(liabilitySchema.parse(ledger.createLiability(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Liability could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_LIABILITY", message } });
    }
  });

  app.patch("/api/v1/liabilities/:id", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = updateLiabilityRequestSchema.parse(request.body);
      return reply.send(liabilitySchema.parse(ledger.updateLiability(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Liability could not be updated.";
      const statusCode = message === "Liability does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_LIABILITY", message } });
    }
  });

  app.post("/api/v1/liabilities/:id/undo-clear", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      return reply.send(liabilitySchema.parse(ledger.undoLiabilityClear(id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Liability clear could not be undone.";
      const statusCode = message === "Liability does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_LIABILITY_UNDO", message } });
    }
  });

  app.post("/api/v1/personal-balances", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createPersonalBalanceRequestSchema.parse(request.body);
      return reply.code(201).send(personalBalanceSchema.parse(ledger.createPersonalBalance(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Personal balance could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_PERSONAL_BALANCE", message } });
    }
  });

  app.patch("/api/v1/personal-balances/:id", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = updatePersonalBalanceRequestSchema.parse(request.body);
      return reply.send(personalBalanceSchema.parse(ledger.updatePersonalBalance(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Personal balance could not be updated.";
      const statusCode = message === "Personal balance does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_PERSONAL_BALANCE", message } });
    }
  });

  app.get("/api/v1/reference-data", async (_request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    return reply.header("cache-control", "no-store").send(referenceDataResponseSchema.parse(ledger.getReferenceData()));
  });

  app.get("/api/v1/imports", async (_request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    return reply.header("cache-control", "no-store").send(importQueueResponseSchema.parse(imports.getQueue()));
  });

  app.post("/api/v1/statement-uploads", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const query = request.query as { filename?: string; accountId?: string };
      const filename = (query.filename ?? "").trim();
      if (!isValidStatementFilename(filename)) {
        throw new Error("A valid statement filename is required.");
      }
      const content = request.body;
      if (!Buffer.isBuffer(content) || content.length === 0) {
        throw new Error("The statement file is empty.");
      }

      const extension = filename.toLowerCase().split(".").pop() ?? "";
      const contentHash = createHash("sha256").update(content).digest("hex");
      const fileType = detectStatementType(content, extension);
      let rows: ReturnType<typeof prepareImportRows> = [];
      let reconciliation: ParsedStatementReconciliation | undefined;
      let status: "parsed" | "needs_parser" | "failed";
      let parserMessage: string;
      if (fileType !== "unknown") {
        try {
          const parsed = await parseStatementContent(content, fileType, filename);
          rows = prepareImportRows(parsed.rows);
          reconciliation = parsed.reconciliation;
          status = "parsed";
          parserMessage = parsed.message;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Statement could not be parsed.";
          status =
            error instanceof StatementPasswordRequiredError || message.includes("OCR is required")
              ? "needs_parser"
              : "failed";
          parserMessage = error instanceof Error ? error.message : "Statement text could not be parsed.";
        }
      } else {
        status = "failed";
        parserMessage = "Unsupported file type. Upload CSV, TSV, PDF, XLS, or XLSX.";
      }

      const quarantineDirectory = join(options.config.dataDirectory, "imports", "quarantine");
      mkdirSync(quarantineDirectory, { recursive: true, mode: 0o700 });
      const quarantinePath = join(quarantineDirectory, `${contentHash}.${fileType === "unknown" ? "bin" : fileType}`);
      writeFileSync(quarantinePath, content, { mode: 0o600 });
      chmodSync(quarantinePath, 0o600);

      const result = imports.createArtifact({
        filename,
        contentHash,
        mimeType: statementMimeType(fileType),
        sizeBytes: content.length,
        accountId: query.accountId || undefined,
        status,
        parserMessage,
        reconciliation,
        rows,
      });
      return reply.code(result.duplicate ? 200 : 201).send(statementUploadResponseSchema.parse(result));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement could not be uploaded.";
      return reply.code(400).send({ error: { code: "INVALID_STATEMENT_UPLOAD", message } });
    }
  });

  app.post("/api/v1/imports/:id/parse", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      const input = statementParseRequestSchema.parse(request.body ?? {});
      const artifact = imports.getArtifactSource(id);
      const fileType = statementFileTypeFromMime(artifact.mimeType);
      if (fileType === "unknown") {
        throw new Error("This source file type cannot be parsed.");
      }
      const quarantinePath = join(
        options.config.dataDirectory,
        "imports",
        "quarantine",
        `${artifact.contentHash}.${fileType}`,
      );
      const content = readFileSync(quarantinePath);
      let parsed: Awaited<ReturnType<typeof parseStatementContent>>;
      try {
        parsed = await parseStatementContent(content, fileType, artifact.filename, input.password);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (fileType !== "pdf" || !message.includes("OCR is required")) {
          throw error;
        }
        parsed = await parseScannedPdfWithLocalOcr(quarantinePath);
      }
      backupBeforeRisk?.("before-import-parse-replacement");
      const updated = imports.replaceArtifactParseResult(id, {
        status: "parsed",
        parserMessage: parsed.message,
        reconciliation: parsed.reconciliation,
        rows: prepareImportRows(parsed.rows),
      });
      return reply.header("cache-control", "no-store").send(importArtifactSchema.parse(updated));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement could not be parsed.";
      const statusCode = message === "Statement artifact does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "STATEMENT_PARSE_FAILED", message } });
    }
  });

  app.post("/api/v1/imports/delete", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const body = request.body as { ids?: unknown };
      if (
        !Array.isArray(body?.ids) ||
        body.ids.length === 0 ||
        !body.ids.every((id) => typeof id === "string" && id.length > 0)
      ) {
        throw new Error("Choose at least one statement to delete.");
      }
      backupBeforeRisk?.("before-import-source-bulk-delete");
      const removed = imports.deleteArtifacts(body.ids);
      const quarantineDirectory = join(options.config.dataDirectory, "imports", "quarantine");
      if (existsSync(quarantineDirectory)) {
        const filenames = readdirSync(quarantineDirectory);
        for (const artifact of removed) {
          for (const filename of filenames) {
            if (filename.startsWith(`${artifact.contentHash}.`)) {
              unlinkSync(join(quarantineDirectory, filename));
            }
          }
        }
      }
      return reply
        .header("cache-control", "no-store")
        .send({ deleted: true, ids: removed.map((artifact) => artifact.id) });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statements could not be deleted.";
      const statusCode = message === "Statement artifact does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "STATEMENT_DELETE_FAILED", message } });
    }
  });

  app.post("/api/v1/imports/:id/reject", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      backupBeforeRisk?.("before-import-source-reject");
      return reply.header("cache-control", "no-store").send(importArtifactSchema.parse(imports.rejectArtifact(id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement could not be rejected.";
      const statusCode = message === "Statement artifact does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "STATEMENT_REJECTION_FAILED", message } });
    }
  });

  app.delete("/api/v1/imports/:id", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      backupBeforeRisk?.("before-import-source-delete");
      const removed = imports.deleteArtifact(id);
      const quarantineDirectory = join(options.config.dataDirectory, "imports", "quarantine");
      if (existsSync(quarantineDirectory)) {
        for (const filename of readdirSync(quarantineDirectory)) {
          if (filename.startsWith(`${removed.contentHash}.`)) {
            unlinkSync(join(quarantineDirectory, filename));
          }
        }
      }
      return reply.header("cache-control", "no-store").send({ deleted: true, id: removed.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement could not be deleted.";
      const statusCode = message === "Statement artifact does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "STATEMENT_DELETE_FAILED", message } });
    }
  });

  app.patch("/api/v1/imports/:id/reconciliation", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      const input = updateStatementReconciliationRequestSchema.parse(request.body);
      return reply.send(importArtifactSchema.parse(imports.updateStatementReconciliation(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement reconciliation could not be updated.";
      const statusCode = message === "Statement artifact does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_STATEMENT_RECONCILIATION", message } });
    }
  });

  app.post("/api/v1/imports/:id/reconcile", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      return reply.send(importArtifactSchema.parse(imports.reconcileStatement(id)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Statement could not be reconciled.";
      const statusCode = message === "Statement artifact does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "STATEMENT_RECONCILIATION_FAILED", message } });
    }
  });

  app.patch("/api/v1/candidates/:id", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      const input = updateImportCandidateRequestSchema.parse(request.body);
      return reply.send(importCandidateSchema.parse(imports.updateCandidate(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import candidate could not be updated.";
      const statusCode = message === "Import candidate does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_IMPORT_CANDIDATE", message } });
    }
  });

  app.post("/api/v1/candidate-actions/approve", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const input = importCandidateActionRequestSchema.parse(request.body);
      backupBeforeRisk?.("before-import-approval");
      return reply.send(importQueueResponseSchema.parse(imports.approveCandidates(input.ids)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import candidates could not be approved.";
      return reply.code(400).send({ error: { code: "INVALID_IMPORT_APPROVAL", message } });
    }
  });

  app.post("/api/v1/candidate-actions/reject", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const input = rejectImportCandidatesRequestSchema.parse(request.body);
      return reply.send(importQueueResponseSchema.parse(imports.rejectCandidates(input.ids, input.reason)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import candidates could not be rejected.";
      return reply.code(400).send({ error: { code: "INVALID_IMPORT_REJECTION", message } });
    }
  });

  app.post("/api/v1/candidate-actions/reset-pending", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const input = importCandidateActionRequestSchema.parse(request.body);
      backupBeforeRisk?.("before-import-reset");
      return reply.send(importQueueResponseSchema.parse(imports.resetCandidatesToPending(input.ids)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Import candidates could not be reset.";
      return reply.code(400).send({ error: { code: "INVALID_IMPORT_RESET", message } });
    }
  });

  app.post("/api/v1/candidates/:id/duplicate-resolution", async (request, reply) => {
    if (!imports) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      const input = resolveImportDuplicateRequestSchema.parse(request.body);
      return reply.send(importQueueResponseSchema.parse(imports.resolveDuplicate(id, input.action)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Duplicate candidate could not be resolved.";
      return reply.code(400).send({ error: { code: "INVALID_DUPLICATE_RESOLUTION", message } });
    }
  });

  app.get("/api/v1/accounts", async (_request, reply) => {
    if (!accounts) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    return reply
      .header("cache-control", "no-store")
      .send(financialAccountsResponseSchema.parse(accounts.getAccounts()));
  });

  app.post("/api/v1/accounts", async (request, reply) => {
    if (!accounts) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const input = createFinancialAccountRequestSchema.parse(request.body);
      return reply.code(201).send(financialAccountSchema.parse(accounts.createAccount(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Financial account could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_ACCOUNT", message } });
    }
  });

  app.patch("/api/v1/accounts/:id", async (request, reply) => {
    if (!accounts) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      const input = updateFinancialAccountRequestSchema.parse(request.body);
      return reply.send(financialAccountSchema.parse(accounts.updateAccount(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Financial account could not be updated.";
      const statusCode = message === "Financial account does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_ACCOUNT", message } });
    }
  });

  app.delete("/api/v1/accounts/:id", async (request, reply) => {
    if (!accounts) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }
    try {
      const { id } = request.params as { id: string };
      accounts.deleteAccount(id);
      return reply.code(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Financial account could not be deleted.";
      const statusCode = message === "Financial account does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_ACCOUNT_DELETE", message } });
    }
  });

  app.get("/api/v1/budgets/:month", async (request, reply) => {
    if (!budgets) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    const { month: rawMonth } = request.params as { month: string };
    const month = monthSchema.parse(rawMonth);
    return reply.header("cache-control", "no-store").send(budgetMonthResponseSchema.parse(budgets.getMonth(month)));
  });

  app.put("/api/v1/budgets/:month", async (request, reply) => {
    if (!budgets) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { month: rawMonth } = request.params as { month: string };
      const month = monthSchema.parse(rawMonth);
      const input = updateBudgetMonthRequestSchema.parse(request.body);
      return reply.send(budgetMonthResponseSchema.parse(budgets.updateMonth(month, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Budget could not be updated.";
      return reply.code(400).send({ error: { code: "INVALID_BUDGET", message } });
    }
  });

  app.get("/api/v1/projects/home-construction", async (_request, reply) => {
    if (!projects) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    return reply
      .header("cache-control", "no-store")
      .send(projectSummaryResponseSchema.parse(projects.getHomeConstruction()));
  });

  app.post("/api/v1/projects/home-construction/expenses", async (request, reply) => {
    if (!projects) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createProjectExpenseRequestSchema.parse(request.body);
      return reply.code(201).send(projectExpenseSchema.parse(projects.createExpense(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project expense could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_PROJECT_EXPENSE", message } });
    }
  });

  app.patch("/api/v1/projects/home-construction/expenses/:id", async (request, reply) => {
    if (!projects) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = updateProjectExpenseRequestSchema.parse(request.body);
      return reply.send(projectExpenseSchema.parse(projects.updateExpense(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project expense could not be updated.";
      const statusCode = message === "Project expense does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_PROJECT_EXPENSE", message } });
    }
  });

  app.post("/api/v1/projects/home-construction/commitments", async (request, reply) => {
    if (!projects) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createProjectCommitmentRequestSchema.parse(request.body);
      return reply.code(201).send(projectCommitmentSchema.parse(projects.createCommitment(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project commitment could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_PROJECT_COMMITMENT", message } });
    }
  });

  app.patch("/api/v1/projects/home-construction/commitments/:id", async (request, reply) => {
    if (!projects) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = updateProjectCommitmentRequestSchema.parse(request.body);
      return reply.send(projectCommitmentSchema.parse(projects.updateCommitment(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Project commitment could not be updated.";
      const statusCode = message === "Project commitment does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_PROJECT_COMMITMENT", message } });
    }
  });

  app.get("/api/v1/wealth", async (_request, reply) => {
    if (!wealth) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    return reply.header("cache-control", "no-store").send(wealthResponseSchema.parse(wealth.getWealth()));
  });

  app.post("/api/v1/wealth/assets", async (request, reply) => {
    if (!wealth) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createWealthAssetRequestSchema.parse(request.body);
      return reply.code(201).send(wealthAssetSchema.parse(wealth.createAsset(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wealth asset could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_WEALTH_ASSET", message } });
    }
  });

  app.patch("/api/v1/wealth/assets/:id", async (request, reply) => {
    if (!wealth) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = updateWealthAssetRequestSchema.parse(request.body);
      return reply.send(wealthAssetSchema.parse(wealth.updateAsset(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wealth asset could not be updated.";
      const statusCode = message === "Wealth asset does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_WEALTH_ASSET", message } });
    }
  });

  app.delete("/api/v1/wealth/assets/:id", async (request, reply) => {
    if (!wealth) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      wealth.deleteAsset(id);
      return reply.code(204).send();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Wealth asset could not be deleted.";
      const statusCode = message === "Wealth asset does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_WEALTH_ASSET", message } });
    }
  });

  app.post("/api/v1/wealth/goals", async (request, reply) => {
    if (!wealth) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createFinancialGoalRequestSchema.parse(request.body);
      return reply.code(201).send(financialGoalSchema.parse(wealth.createGoal(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Financial goal could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_FINANCIAL_GOAL", message } });
    }
  });

  app.patch("/api/v1/wealth/goals/:id", async (request, reply) => {
    if (!wealth) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = updateFinancialGoalRequestSchema.parse(request.body);
      return reply.send(financialGoalSchema.parse(wealth.updateGoal(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Financial goal could not be updated.";
      const statusCode = message === "Financial goal does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_FINANCIAL_GOAL", message } });
    }
  });

  app.put("/api/v1/wealth/goals/:id/allocations", async (request, reply) => {
    if (!wealth) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = updateGoalAllocationsRequestSchema.parse(request.body);
      return reply.send(financialGoalSchema.parse(wealth.updateGoalAllocations(id, input.allocations)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Goal allocations could not be updated.";
      const statusCode = message === "Financial goal does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_GOAL_ALLOCATION", message } });
    }
  });

  app.post("/api/v1/transactions/manual", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createManualTransactionRequestSchema.parse(request.body);
      return reply.code(201).send(ledgerTransactionSchema.parse(ledger.createManualTransaction(input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_TRANSACTION", message } });
    }
  });

  app.post("/api/v1/transactions/:id/reverse", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = reverseTransactionRequestSchema.parse(request.body);
      return reply.send(ledgerTransactionSchema.parse(ledger.reverseTransaction(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction could not be reversed.";
      const statusCode = message === "Transaction does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_TRANSACTION_REVERSAL", message } });
    }
  });

  app.post("/api/v1/transactions/:id/replace", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const { id } = request.params as { id: string };
      const input = replaceTransactionRequestSchema.parse(request.body);
      return reply.send(ledgerTransactionSchema.parse(ledger.replaceTransaction(id, input)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction could not be corrected.";
      const statusCode = message === "Transaction does not exist." ? 404 : 400;
      return reply.code(statusCode).send({ error: { code: "INVALID_TRANSACTION_REPLACEMENT", message } });
    }
  });

  app.addHook("onClose", async () => {
    database?.close();
  });

  return app;
}
