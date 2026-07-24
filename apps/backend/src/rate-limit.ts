export class RateLimiter {
  readonly #entries = new Map<string, number[]>();

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

  clear(): void {
    this.#entries.clear();
  }
}
