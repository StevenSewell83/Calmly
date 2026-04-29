-- F-12 encrypted-at-rest secret store.
-- Holds OS-keychain-backed ciphertext for API keys, OAuth refresh tokens, session cookies.
-- The plaintext only ever exists in memory in the main process; this table never sees it.
CREATE TABLE secrets (
  key TEXT PRIMARY KEY,
  ciphertext BLOB NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
) STRICT;
