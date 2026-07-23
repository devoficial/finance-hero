import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  budgetMonthResponseSchema,
  createLiabilityRequestSchema,
  createManualTransactionRequestSchema,
  createPersonalBalanceRequestSchema,
  createProjectCommitmentRequestSchema,
  createProjectExpenseRequestSchema,
  dashboardResponseSchema,
  expenseYearResponseSchema,
  healthResponseSchema,
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
  replaceTransactionRequestSchema,
  reverseTransactionRequestSchema,
  updateBudgetMonthRequestSchema,
  updateLiabilityRequestSchema,
  updatePersonalBalanceRequestSchema,
  updateProjectCommitmentRequestSchema,
  updateProjectExpenseRequestSchema,
  yearSchema,
} from "@finance-hero/contracts";
import {
  BudgetRepository,
  type FinanceHeroDatabase,
  initializeFoundationSchema,
  LedgerRepository,
  openEncryptedDatabase,
  ProjectRepository,
  seedAcceptedOpeningSnapshot,
} from "@finance-hero/database";
import Fastify, { type FastifyInstance } from "fastify";
import type { ServerConfig } from "./config";

export interface BuildAppOptions {
  config: ServerConfig;
  version?: string;
  logger?: boolean;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: options.logger ?? false });
  let database: FinanceHeroDatabase | undefined;
  let budgets: BudgetRepository | undefined;
  let ledger: LedgerRepository | undefined;
  let projects: ProjectRepository | undefined;

  if (options.config.databaseKey) {
    mkdirSync(options.config.dataDirectory, { recursive: true, mode: 0o700 });
    database = openEncryptedDatabase(
      join(options.config.dataDirectory, "finance-hero.db"),
      Buffer.from(options.config.databaseKey, "utf8"),
    );
    initializeFoundationSchema(database);
    seedAcceptedOpeningSnapshot(database);
    ledger = new LedgerRepository(database);
    budgets = new BudgetRepository(database);
    projects = new ProjectRepository(database, ledger);
  }

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

  app.get("/api/v1/dashboard", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    const query = request.query as { month?: string };
    const month = monthSchema.parse(query.month ?? "2026-07");
    const localDay = Number(
      new Intl.DateTimeFormat("en-IN", { day: "numeric", timeZone: "Asia/Kolkata" }).format(new Date()),
    );
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
