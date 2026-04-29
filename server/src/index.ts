import { buildApp } from "./app";
import { loadConfig } from "./config";
import { createPool } from "./db/pool";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createPool(config.DATABASE_URL);
  const app = await buildApp({ config, pool });

  await app.listen({ port: config.PORT, host: config.HOST });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info({ signal }, "shutdown initiated");
    try {
      await app.close();
      await pool.end();
      app.log.info("shutdown complete");
      process.exit(0);
    } catch (err) {
      app.log.error({ err }, "shutdown failed");
      process.exit(1);
    }
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[calmly:server] boot failed:", err);
  process.exit(1);
});
