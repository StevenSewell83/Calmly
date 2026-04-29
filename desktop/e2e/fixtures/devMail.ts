import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

export interface MagicLinkEmail {
  filepath: string;
  link: string;
  token: string;
  writtenAt: Date;
}

export interface PollOptions {
  // Only consider files written at or after this instant. Use this to scope
  // a poll to messages produced by a specific test step.
  since?: Date;
  // Cap the wait. Defaults to 10s — generous for ConsoleEmailSender's single
  // writeFile.
  timeoutMs?: number;
  // Polling interval. Defaults to 100ms.
  intervalMs?: number;
}

const HREF_RE = /href="([^"]*\/auth\/magic-link\/redeem\?token=[^"]+)"/i;

// Poll the dev-mail directory for the next magic-link HTML produced by the
// ConsoleEmailSender. Returns the first matching file written at-or-after
// `since`. Throws if no match arrives within the timeout.
//
// fs.watch is unreliable across platforms for directory creation events
// (no recursive on Linux without Node 20.x options, no inode reuse on
// macOS), so we just poll. The interval is short enough to feel instant in
// local runs and the body is cheap (one readdir + one stat per file).
export async function pollForMagicLink(
  devMailDir: string,
  opts: PollOptions = {},
): Promise<MagicLinkEmail> {
  const since = opts.since?.getTime() ?? 0;
  const timeoutMs = opts.timeoutMs ?? 10_000;
  const intervalMs = opts.intervalMs ?? 100;
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const candidate = await findCandidate(devMailDir, since);
    if (candidate) return candidate;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error(
    `pollForMagicLink: no magic-link email appeared in ${devMailDir} within ${timeoutMs}ms (since=${new Date(since).toISOString()})`,
  );
}

async function findCandidate(
  dir: string,
  since: number,
): Promise<MagicLinkEmail | null> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    // Directory doesn't exist yet; the server hasn't sent anything.
    return null;
  }
  const htmls = entries.filter((f) => f.endsWith(".html"));
  // Sort newest-first so we surface the most recent message first.
  const stamped: Array<{ name: string; mtimeMs: number }> = [];
  for (const name of htmls) {
    try {
      const s = await stat(join(dir, name));
      stamped.push({ name, mtimeMs: s.mtimeMs });
    } catch {
      // File vanished between readdir and stat; skip.
    }
  }
  stamped.sort((a, b) => b.mtimeMs - a.mtimeMs);

  for (const { name, mtimeMs } of stamped) {
    if (mtimeMs < since) continue;
    const filepath = join(dir, name);
    const content = await readFile(filepath, "utf-8");
    const m = content.match(HREF_RE);
    if (!m || !m[1]) continue;
    const link = decodeHtmlEntities(m[1]);
    const token = new URL(link).searchParams.get("token");
    if (!token) continue;
    return {
      filepath,
      link,
      token,
      writtenAt: new Date(mtimeMs),
    };
  }
  return null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
