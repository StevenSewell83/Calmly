import type { FastifyBaseLogger } from "fastify";

export interface MagicLinkEmail {
  to: string;
  link: string;
  expiresAt: Date;
}

export interface EmailAdapter {
  sendMagicLink(args: MagicLinkEmail): Promise<void>;
}

export class ConsoleEmailAdapter implements EmailAdapter {
  constructor(private readonly log: FastifyBaseLogger) {}

  async sendMagicLink(args: MagicLinkEmail): Promise<void> {
    // The link itself is sensitive; logged at info in dev so a developer can
    // copy-paste into the redeem flow. F-09's production adapter will replace
    // this with a real email send and never log the link.
    this.log.info(
      { to: args.to, expiresAt: args.expiresAt.toISOString(), link: args.link },
      "[email:console] magic link",
    );
  }
}
