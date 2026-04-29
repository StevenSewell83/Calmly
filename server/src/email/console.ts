import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve as pathResolve } from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { EmailAdapter, MagicLinkEmail } from "./adapter";
import { renderMagicLinkEmail } from "./template";

export interface ConsoleEmailSenderArgs {
  log: FastifyBaseLogger;
  // Where to drop one .html per send so a developer can open it in the browser
  // and see exactly what a recipient would see. Defaults to ./.dev-mail.
  dir: string;
}

export class ConsoleEmailSender implements EmailAdapter {
  constructor(private readonly args: ConsoleEmailSenderArgs) {}

  async sendMagicLink(email: MagicLinkEmail): Promise<void> {
    const rendered = renderMagicLinkEmail({
      link: email.link,
      expiresAt: email.expiresAt,
    });

    const dir = pathResolve(this.args.dir);
    await mkdir(dir, { recursive: true });

    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const tag = createHash("sha256")
      .update(email.link)
      .digest("hex")
      .slice(0, 8);
    const filename = `${ts}-${tag}.html`;
    const filepath = join(dir, filename);
    await writeFile(filepath, rendered.html, "utf-8");

    this.args.log.info(
      {
        to: email.to,
        expiresAt: email.expiresAt.toISOString(),
        file: filepath,
        link: email.link,
      },
      "[email:console] magic link written",
    );
  }
}
