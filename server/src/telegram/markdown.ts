// TGR-04 — MarkdownV2 escaping helper. Telegram's Bot API requires every
// reserved character below to be backslash-escaped in any text sent with
// parse_mode: 'MarkdownV2' (outside of an actual entity) or the whole
// sendMessage call fails with a 400 "can't parse entities" error — so
// this must run over any user-authored string (task titles, next steps)
// before it lands in a MarkdownV2 reply. Shared by /now (TGR-04) and
// /today, /inbox (TGR-05).
//
// Reserved set per https://core.telegram.org/bots/api#markdownv2-style
const RESERVED_CHARS = /[_*[\]()~`>#+\-=|{}.!\\]/g;

export function escapeMarkdownV2(text: string): string {
  return text.replace(RESERVED_CHARS, (ch) => `\\${ch}`);
}
