import { buildApp } from "./app";
import { readRuntimeConfig } from "./config";

const config = await readRuntimeConfig();
const app = await buildApp({ config, logger: true });

try {
  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  app.log.error(error);
  process.exitCode = 1;
}
