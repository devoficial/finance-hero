import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  createManualTransactionRequestSchema,
  dashboardResponseSchema,
  expenseYearResponseSchema,
  healthResponseSchema,
  ledgerResponseSchema,
  liabilitiesResponseSchema,
  liabilitySchema,
  monthSchema,
  referenceDataResponseSchema,
  updateLiabilityRequestSchema,
  yearSchema,
} from "@finance-hero/contracts";
import {
  type FinanceHeroDatabase,
  initializeFoundationSchema,
  LedgerRepository,
  openEncryptedDatabase,
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
  let ledger: LedgerRepository | undefined;

  if (options.config.databaseKey) {
    mkdirSync(options.config.dataDirectory, { recursive: true, mode: 0o700 });
    database = openEncryptedDatabase(
      join(options.config.dataDirectory, "finance-hero.db"),
      Buffer.from(options.config.databaseKey, "utf8"),
    );
    initializeFoundationSchema(database);
    seedAcceptedOpeningSnapshot(database);
    ledger = new LedgerRepository(database);
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

  app.get("/api/v1/reference-data", async (_request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    return reply.header("cache-control", "no-store").send(referenceDataResponseSchema.parse(ledger.getReferenceData()));
  });

  app.post("/api/v1/transactions/manual", async (request, reply) => {
    if (!ledger) {
      return reply.code(503).send({ error: { code: "DATABASE_UNAVAILABLE", message: "Database is not configured." } });
    }

    try {
      const input = createManualTransactionRequestSchema.parse(request.body);
      return reply.code(201).send(ledger.createManualTransaction(input));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Transaction could not be created.";
      return reply.code(400).send({ error: { code: "INVALID_TRANSACTION", message } });
    }
  });

  app.addHook("onClose", async () => {
    database?.close();
  });

  return app;
}
