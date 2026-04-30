import { z } from "zod";

export const TelegramConfigSchema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_WEBHOOK_SECRET: z.string().min(16).default("dev-webhook-secret"),
  TELEGRAM_WEBHOOK_URL: z.string().url().optional(),
});

export type TelegramConfig = z.infer<typeof TelegramConfigSchema>;

export function loadTelegramConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelegramConfig | null {
  const token = env["TELEGRAM_BOT_TOKEN"];
  if (!token) return null;

  const result = TelegramConfigSchema.safeParse(env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid Telegram config:\n${issues}`);
  }
  return result.data;
}
