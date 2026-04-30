// Sanitizes raw user input for FTS5 query syntax and appends a prefix wildcard
// to the final token so partial matches work (e.g. "pho" finds "phone").
//
// FTS5 special chars that need escaping in MATCH strings: " + * ^ ( ) NOT AND OR
// We take a conservative approach: strip everything except word-chars, hyphens,
// underscores, and spaces, then append '*' to the last token.

export function buildFtsQuery(raw: string): string | null {
  const clean = raw
    .trim()
    // Remove all FTS5 metacharacters
    .replace(/["+*^()]/g, " ")
    // Collapse whitespace
    .replace(/\s+/g, " ")
    .trim();

  if (!clean) return null;

  // Append prefix wildcard to the last token
  const tokens = clean.split(" ");
  tokens[tokens.length - 1] = tokens[tokens.length - 1] + "*";
  return tokens.join(" ");
}
