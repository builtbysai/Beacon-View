// Generously covers every window currently passed to take() (<=1 hour) many
// times over, so a key is only ever swept once it is truly inactive.
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1_000;
const SWEEP_INTERVAL_MS = 10 * 60 * 1_000;

export class RateLimiter {
  readonly #entries = new Map<string, number[]>();
  readonly #sweepTimer: ReturnType<typeof setInterval>;

  constructor() {
    // Without this sweep, a single distinct key (e.g. one hashed email or IP)
    // that never repeats stays in #entries forever, since take() only prunes
    // the array it looks up, not unrelated keys -- an attacker cycling
    // through many distinct emails/IPs against a rate-limited endpoint would
    // otherwise grow this map without bound for the life of the process.
    this.#sweepTimer = setInterval(() => this.#sweep(), SWEEP_INTERVAL_MS);
    this.#sweepTimer.unref();
  }

  take(
    key: string,
    limit: number,
    windowMs: number,
    now = Date.now(),
  ): boolean {
    const cutoff = now - windowMs;
    const attempts = (this.#entries.get(key) ?? []).filter(
      (attempt) => attempt > cutoff,
    );
    if (attempts.length >= limit) {
      this.#entries.set(key, attempts);
      return false;
    }
    attempts.push(now);
    this.#entries.set(key, attempts);
    return true;
  }

  #sweep(now = Date.now()): void {
    const cutoff = now - STALE_THRESHOLD_MS;
    for (const [key, attempts] of this.#entries) {
      if (attempts.every((attempt) => attempt <= cutoff)) {
        this.#entries.delete(key);
      }
    }
  }

  /** Number of distinct keys currently tracked; exists so tests can observe
   * that stale keys are actually swept, not for runtime decision-making. */
  get size(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  close(): void {
    clearInterval(this.#sweepTimer);
  }
}
