import fastifyCookie from "@fastify/cookie";
import Fastify, { type FastifyInstance } from "fastify";
import type pg from "pg";
import { authRoutesPlugin } from "./auth/routes";
import type { Config } from "./config";
import type { EmailAdapter } from "./email/adapter";
import { selectEmailSender } from "./email/select";
import { googleOAuthPlugin } from "./routes/oauth/google";
import { microsoftOAuthPlugin } from "./routes/oauth/microsoft";
import { healthRoute } from "./routes/health";
import { versionRoute } from "./routes/version";
import { syncRoutes } from "./sync/routes";
import { initBot, telegramPlugin, loadTelegramConfig } from "./telegram";

declare module "fastify" {
  interface FastifyInstance {
    pool: pg.Pool;
    appConfig: Config;
  }
}

export interface AppDeps {
  config: Config;
  pool: pg.Pool;
  email?: EmailAdapter;
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
          'req.headers["x-telegram-bot-api-secret-token"]',
          "*.password",
          "*.token",
          "*.refresh_token",
          "*.api_key",
          "*.bot_token",
        ],
        remove: true,
      },
    },
    trustProxy: true,
  });

  app.decorate("pool", deps.pool);
  app.decorate("appConfig", deps.config);

  await app.register(fastifyCookie, { secret: deps.config.COOKIE_SECRET });
  await app.register(healthRoute);
  await app.register(versionRoute);
  const email = deps.email ?? selectEmailSender(deps.config, app.log);
  await app.register(authRoutesPlugin({ email }));
  await app.register(syncRoutes);

  // Telegram integration — optional; only wired when TELEGRAM_BOT_TOKEN is set.
  const tgConfig = loadTelegramConfig();
  if (tgConfig) {
    initBot(tgConfig);
    await app.register(telegramPlugin(tgConfig));
    app.log.info("[telegram] webhook registered");
  }

  // CAL-01 / CAL-02 Calendar OAuth — each provider is optional; only wired
  // when its client ID + secret are configured. We fall back to COOKIE_SECRET
  // for ticket signing in dev so a single env-var is enough to spin the flow up.
  const ticketSecret =
    deps.config.OAUTH_TICKET_SECRET ?? deps.config.COOKIE_SECRET;
  const oauthRedirectBase =
    deps.config.OAUTH_REDIRECT_BASE_URL ?? deps.config.APP_URL;

  if (deps.config.GOOGLE_CLIENT_ID && deps.config.GOOGLE_CLIENT_SECRET) {
    await app.register(
      googleOAuthPlugin({
        clientId: deps.config.GOOGLE_CLIENT_ID,
        clientSecret: deps.config.GOOGLE_CLIENT_SECRET,
        redirectBaseUrl: oauthRedirectBase,
        ticketSecret,
        stateTtlSec: deps.config.OAUTH_STATE_TTL_SEC,
        ticketTtlSec: deps.config.OAUTH_TICKET_TTL_SEC,
      }),
    );
    app.log.info("[oauth] google calendar routes registered");
  }

  if (deps.config.MICROSOFT_CLIENT_ID && deps.config.MICROSOFT_CLIENT_SECRET) {
    await app.register(
      microsoftOAuthPlugin({
        clientId: deps.config.MICROSOFT_CLIENT_ID,
        clientSecret: deps.config.MICROSOFT_CLIENT_SECRET,
        redirectBaseUrl: oauthRedirectBase,
        ticketSecret,
        stateTtlSec: deps.config.OAUTH_STATE_TTL_SEC,
        ticketTtlSec: deps.config.OAUTH_TICKET_TTL_SEC,
      }),
    );
    app.log.info("[oauth] microsoft calendar routes registered");
  }

  return app;
}
