import type { FastifyBaseLogger } from "fastify";
import type { EmailAdapter, MagicLinkEmail } from "./adapter";
import { renderMagicLinkEmail } from "./template";

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export class ResendEmailError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: string,
  ) {
    super(message);
    this.name = "ResendEmailError";
  }
}

export interface ResendEmailSenderArgs {
  apiKey: string;
  from: string;
  log: FastifyBaseLogger;
  fetchImpl?: typeof fetch;
}

interface ResendPayload {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
}

export class ResendEmailSender implements EmailAdapter {
  private readonly fetchFn: typeof fetch;

  constructor(private readonly args: ResendEmailSenderArgs) {
    this.fetchFn = args.fetchImpl ?? fetch;
  }

  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    const rendered = renderMagicLinkEmail({
      link: email.link,
      expiresAt: email.expiresAt,
    });
    const payload: ResendPayload = {
      from: this.args.from,
      to: [email.to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    };

    const res = await this.fetchFn(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.args.apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ResendEmailError(
        `resend send failed: ${res.status}`,
        res.status,
        body,
      );
    }

    // Resend returns { id } on success; we don't currently persist it.
    this.args.log.info(
      { to: email.to, expiresAt: email.expiresAt.toISOString() },
      "[email:resend] magic link sent",
    );
  }
}
