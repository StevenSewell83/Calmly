// Pure rendering for the magic-link email. Returns subject + HTML + plain text.
// The plain text body is the a11y fallback and contains the full URL, per F-09
// acceptance — a screen reader / non-HTML client must still be able to act.

export interface MagicLinkTemplateInput {
  link: string;
  expiresAt: Date;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderMagicLinkEmail(
  input: MagicLinkTemplateInput,
): RenderedEmail {
  const safeLink = escapeHtml(input.link);
  const minutes = Math.max(
    1,
    Math.round((input.expiresAt.getTime() - Date.now()) / 60_000),
  );

  const subject = "Your Calmly sign-in link";

  const text = [
    "Sign in to Calmly",
    "",
    `Open this link to sign in. It expires in about ${minutes} minutes.`,
    "",
    input.link,
    "",
    "If you didn't request this, you can ignore this email — nothing changes.",
  ].join("\n");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sign in to Calmly</title>
  </head>
  <body style="margin:0;padding:0;background:#f9f7f2;font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:#292524;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
      <tr>
        <td align="center" style="padding:48px 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:520px;background:#ffffff;border:1px solid #e7e5e4;border-radius:24px;">
            <tr>
              <td style="padding:40px;">
                <h1 style="margin:0 0 16px 0;font-family:ui-serif,Georgia,serif;font-style:italic;font-size:28px;color:#1c1917;">
                  Peace, friend.
                </h1>
                <p style="margin:0 0 24px 0;font-size:15px;line-height:1.55;color:#57534e;">
                  Tap the button below to sign in. The link expires in about ${minutes} minutes.
                </p>
                <p style="margin:0 0 24px 0;">
                  <a href="${safeLink}" style="display:inline-block;padding:12px 24px;background:#10b981;color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px;letter-spacing:0.02em;">
                    Sign in to Calmly
                  </a>
                </p>
                <p style="margin:0 0 8px 0;font-size:12px;color:#a8a29e;">
                  Or paste this link into your browser:
                </p>
                <p style="margin:0 0 24px 0;font-size:12px;line-height:1.5;color:#57534e;word-break:break-all;">
                  <a href="${safeLink}" style="color:#057a55;text-decoration:underline;">${safeLink}</a>
                </p>
                <p style="margin:24px 0 0 0;padding-top:24px;border-top:1px solid #f5f5f4;font-size:12px;color:#a8a29e;">
                  Didn't request this? You can ignore this email — nothing changes.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}
