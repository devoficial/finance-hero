import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { healthResponseSchema } from "@finance-hero/contracts";
import { type FinanceHeroDatabase, initializeFoundationSchema, openEncryptedDatabase } from "@finance-hero/database";
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

  if (options.config.databaseKey) {
    mkdirSync(options.config.dataDirectory, { recursive: true, mode: 0o700 });
    database = openEncryptedDatabase(
      join(options.config.dataDirectory, "finance-hero.db"),
      Buffer.from(options.config.databaseKey, "utf8"),
    );
    initializeFoundationSchema(database);
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

  app.addHook("onClose", async () => {
    database?.close();
  });

  return app;
}
