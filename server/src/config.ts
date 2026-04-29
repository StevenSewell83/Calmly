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
  COOKIE_SECRET: z.string().min(32).default("dev-cookie-secret-change-in-prod-32+"),
  MAGIC_LINK_TTL_MIN: z.coerce.number().int().positive().default(15),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(30),
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
