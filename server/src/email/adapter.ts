// The wire interface every email sender implements. Concrete senders live in
// console.ts (dev: writes an .html file + logs the link) and resend.ts
// (prod: posts to Resend's REST API). selectEmailSender(config) chooses one
// based on EMAIL_SENDER.

export interface MagicLinkEmail {
  to: string;
  link: string;
  expiresAt: Date;
}

export interface EmailAdapter {
  sendMagicLink(args: MagicLinkEmail): Promise<void>;
}
