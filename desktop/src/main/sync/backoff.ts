// Exponential backoff with a cap. A fresh failure (attempts === 0 → first
// retry after 1s, then 2s, 4s, ..., capped at 60s). Pure math so the unit
// test runs without DB or HTTP.

const BASE_MS = 1000;
const CAP_MS = 60_000;

export function backoffDelayMs(attempts: number): number {
  if (attempts <= 0) return BASE_MS;
  const exp = Math.min(attempts, 30); // guard against overflow
  const delay = BASE_MS * 2 ** exp;
  return Math.min(delay, CAP_MS);
}

export function nextRetryAt(attempts: number, now: number): number {
  return now + backoffDelayMs(attempts);
}
