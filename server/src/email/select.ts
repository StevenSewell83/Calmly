import type { FastifyBaseLogger } from "fastify";
import type { Config } from "../config";
import type { EmailAdapter } from "./adapter";
import { ConsoleEmailSender } from "./console";
import { ResendEmailSender } from "./resend";

export function selectEmailSender(
  config: Config,
  log: FastifyBaseLogger,
): EmailAdapter {
  if (config.EMAIL_SENDER === "resend") {
    if (!config.RESEND_API_KEY) {
      throw new Error(
        "EMAIL_SENDER=resend requires RESEND_API_KEY in the environment",
      );
    }
    if (!config.EMAIL_FROM) {
      throw new Error(
        "EMAIL_SENDER=resend requires EMAIL_FROM in the environment",
      );
    }
    return new ResendEmailSender({
      apiKey: config.RESEND_API_KEY,
      from: config.EMAIL_FROM,
      log,
    });
  }
  return new ConsoleEmailSender({ log, dir: config.DEV_MAIL_DIR });
}
