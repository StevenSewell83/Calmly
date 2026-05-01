// TG-02b: /start command handler.
//
// /start          — onboarding message with instructions to generate a code in the app
// /start <CODE>   — redeem a linking code; reply with success or a specific error message
import type { Message } from "grammy/types";
import type { FastifyBaseLogger } from "fastify";
import type pg from "pg";
import { redeemLinkingCode } from "../linking";

const ONBOARDING_TEXT =
  "Welcome to Calmly! To link this Telegram account, open the Calmly desktop app, " +
  "go to Settings → Telegram, generate a linking code, and send it here as /start <CODE>.";

const REPLIES: Record<string, string> = {
  success: "Your Telegram account is now linked to Calmly. You can send tasks and voice notes here.",
  not_found: "That code wasn't found. Generate a new one in Settings → Telegram.",
  expired: "That code has expired. Generate a new one in Settings → Telegram.",
  already_used: "That code has already been used. Generate a new one in Settings → Telegram.",
};

export async function handleStart(
  message: Message,
  pool: pg.Pool,
  log: FastifyBaseLogger,
): Promise<string> {
  const text = message.text ?? "";
  const parts = text.trim().split(/\s+/);
  const rawCode = parts[1];

  if (!rawCode) {
    return ONBOARDING_TEXT;
  }

  const chatId = String(message.chat.id);
  const username = message.from?.username;
  const result = await redeemLinkingCode(pool, rawCode, chatId, username ?? null, Date.now());

  if (result.ok) {
    log.info({ chatId, userId: result.userId }, "[telegram] account linked");
    return REPLIES["success"]!;
  }

  log.info({ chatId, error: result.error }, "[telegram] linking code rejected");
  return REPLIES[result.error] ?? ONBOARDING_TEXT;
}
