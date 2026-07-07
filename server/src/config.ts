import "dotenv/config";
import { z } from "zod";

const ConfigSchema = z.object({
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("127.0.0.1"),
  DATABASE_URL: z
    .string()
    .min(1)
    .refine((s) => /^postgres(ql)?:\/\//.test(s), {
      message: "DATABASE_URL must be a postgres:// or postgresql:// URL",
    }),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  APP_URL: z.string().url().default("http://localhost:3001"),
  COOKIE_NAME: z.string().min(1).default("calmly_session"),
  // Used by @fastify/cookie for signed cookies. Not currently signing the
  // session cookie itself (we sha256 the value at lookup), but the secret is
  // required for future signed flows (CSRF tokens, magic-link state).
  COOKIE_SECRET: z
    .string()
    .min(32)
    .default("dev-cookie-secret-change-in-prod-32+"),
  MAGIC_LINK_TTL_MIN: z.coerce.number().int().positive().default(15),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),

  // F-09 email send adapter
  EMAIL_SENDER: z.enum(["console", "resend"]).default("console"),
  EMAIL_FROM: z.string().min(1).optional(),
  RESEND_API_KEY: z.string().min(1).optional(),
  DEV_MAIL_DIR: z.string().min(1).default("./.dev-mail"),

  // CAL-01 / CAL-02 calendar OAuth. Optional: when GOOGLE_CLIENT_ID + secret
  // are not set, the /oauth/google/* routes are simply not registered.
  GOOGLE_CLIENT_ID: z.string().min(1).optional(),
  GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
  MICROSOFT_CLIENT_ID: z.string().min(1).optional(),
  MICROSOFT_CLIENT_SECRET: z.string().min(1).optional(),
  // Where the OAuth provider redirects after consent. Defaults to APP_URL,
  // so the caller only needs to override this if the public-facing host
  // differs from APP_URL (e.g. behind a reverse proxy on a different domain).
  OAUTH_REDIRECT_BASE_URL: z.string().url().optional(),
  // HMAC key for one-shot OAuth pickup tickets. Required when ANY OAuth
  // provider is configured; falls back to COOKIE_SECRET so a single-secret
  // dev setup just works.
  OAUTH_TICKET_SECRET: z.string().min(32).optional(),
  OAUTH_STATE_TTL_SEC: z.coerce.number().int().positive().default(600),
  OAUTH_TICKET_TTL_SEC: z.coerce.number().int().positive().default(300),

  // TGR-08 reminder scheduler tick interval. Overridable mainly for tests;
  // production should stay at the 30s default from the spec.
  REMINDER_TICK_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = ConfigSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid server config:\n${issues}`);
  }
  return parsed.data;
}
