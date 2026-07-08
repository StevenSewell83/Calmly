// Exponential backoff with a cap and ±20% jitter. A fresh failure
// (attempts === 0) → first retry after ~1s, then ~2s, ~4s, ..., capped at
// ~60s. Jitter spreads a batch of ops that failed together so they don't
// retry in lockstep against the server. Pure math so the unit test runs
// without DB or HTTP; pass a fixed `rand` for determinism (0.5 → no jitter).

const BASE_MS = 1000;
const CAP_MS = 60_000;
const JITTER = 0.2;

export function backoffDelayMs(
  attempts: number,
  rand: () => number = Math.random,
): number {
  const exp = Math.min(Math.max(attempts, 0), 30); // guard against overflow
  const delay = Math.min(BASE_MS * 2 ** exp, CAP_MS);
  // rand()=0 → 0.8x, rand()=0.5 → 1x, rand()=1 → 1.2x
  return Math.round(delay * (1 - JITTER + 2 * JITTER * rand()));
}

/** Upper bound of the jittered delay — what callers must wait to be CERTAIN
 * an op is ready regardless of the jitter roll. */
export function maxBackoffDelayMs(attempts: number): number {
  const exp = Math.min(Math.max(attempts, 0), 30);
  const delay = Math.min(BASE_MS * 2 ** exp, CAP_MS);
  return Math.round(delay * (1 + JITTER));
}

export function nextRetryAt(
  attempts: number,
  now: number,
  rand: () => number = Math.random,
): number {
  return now + backoffDelayMs(attempts, rand);
}
