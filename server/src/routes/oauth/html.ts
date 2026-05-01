import type { FastifyReply } from "fastify";

// Tiny inline HTML for the OAuth callback page. The user sees this between
// "consented at Google" and "back in the desktop app." Kept text-only and
// CSP-safe; the only inline script is a single setTimeout that bounces to
// the calmly:// deep-link.

export interface RenderSuccessArgs {
  reply: FastifyReply;
  provider: "google" | "microsoft";
  ticket: string;
}

export function renderOAuthSuccess(args: RenderSuccessArgs): void {
  const safe = encodeURIComponent(args.ticket);
  const target = `calmly://oauth/${args.provider}/done?ticket=${safe}`;
  args.reply
    .type("text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .send(
      `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Calmly — calendar connected</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background:#f5f5f4; color:#292524; padding:3rem 1.5rem; }
  main { max-width: 32rem; margin: 0 auto; text-align: center; }
  h1 { font-size: 1.25rem; margin: 1rem 0 0.5rem; font-weight: 600; }
  p  { color:#57534e; line-height:1.55; }
  a.btn { display:inline-block; margin-top:1.25rem; padding:0.75rem 1.25rem; border-radius:9999px;
          background:#059669; color:white; text-decoration:none; font-weight:600; }
</style>
</head><body><main>
  <h1>Connected. Returning to Calmly…</h1>
  <p>If the desktop app didn't open automatically, click below.</p>
  <a class="btn" href="${target}">Open Calmly</a>
  <noscript><p style="margin-top:1.5rem;color:#a8a29e">Click the button above to finish connecting.</p></noscript>
</main>
<script>setTimeout(function(){ window.location = ${JSON.stringify(target)}; }, 50);</script>
</body></html>`,
    );
}

export interface RenderErrorArgs {
  reply: FastifyReply;
  code: string;
  description: string | null;
}

export function renderOAuthError(args: RenderErrorArgs): void {
  args.reply
    .code(400)
    .type("text/html; charset=utf-8")
    .header("cache-control", "no-store")
    .send(
      `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<title>Calmly — calendar connection failed</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { font-family: ui-sans-serif, system-ui, sans-serif; background:#f5f5f4; color:#292524; padding:3rem 1.5rem; }
  main { max-width: 32rem; margin: 0 auto; text-align: center; }
  h1 { font-size: 1.25rem; margin: 1rem 0 0.5rem; font-weight:600; }
  p  { color:#57534e; line-height:1.55; }
  code { background:#e7e5e4; padding:0.1rem 0.4rem; border-radius:0.25rem; }
</style>
</head><body><main>
  <h1>We couldn't connect that calendar.</h1>
  <p>You can close this tab and try again from Calmly.</p>
  <p style="margin-top:1.25rem;font-size:0.875rem">Reason: <code>${escapeHtml(args.code)}</code>${args.description ? ` — ${escapeHtml(args.description)}` : ""}</p>
</main></body></html>`,
    );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
