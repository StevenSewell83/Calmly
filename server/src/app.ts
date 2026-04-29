import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import type { Config } from "./config";
import { healthRoute } from "./routes/health";
import { versionRoute } from "./routes/version";

declare module "fastify" {
  interface FastifyInstance {
    pool: pg.Pool;
    appConfig: Config;
  }
}

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const isDev = deps.config.NODE_ENV === "development";
  const app = Fastify({
    logger: {
      level: deps.config.LOG_LEVEL,
      ...(isDev
        ? {
            transport: {
              target: "pino-pretty",
              options: {
                translateTime: "HH:MM:ss",
                ignore: "pid,hostname",
              },
            },
          }
        : {}),
      redact: {
        paths: [
          "req.headers.authorization",
          "req.headers.cookie",
          'req.headers["x-api-key"]',
          "*.password",
          "*.token",
          "*.refresh_token",
          "*.api_key",
        ],
        remove: true,
      },
    },
    trustProxy: true,
  });

  app.decorate("pool", deps.pool);
  app.decorate("appConfig", deps.config);

  await app.register(healthRoute);
  await app.register(versionRoute);

  return app;
}
