/** After this many quick attempts the screen says why it is not live (for
 * example "camera offline") instead of "retrying", but Beacon keeps trying. */
export const FAST_RETRIES = 5;

export type ConnectionFailure =
  | 'authorization lost'
  | 'camera offline'
  | 'connection timed out'
  | 'ICE failed'
  | 'signaling unavailable';

export function retryDelay(
  attempt: number,
  jitter: number,
  baseDelayMs = 1_000,
  maximumDelayMs = 16_000,
): number {
  const boundedAttempt = Math.max(0, attempt);
  const exponential = Math.min(
    maximumDelayMs,
    baseDelayMs * 2 ** boundedAttempt,
  );
  const boundedJitter = Math.min(1, Math.max(0, jitter));
  return Math.round(exponential * (0.75 + boundedJitter * 0.5));
}

/** Everything except lost authorization is worth another try, indefinitely
 * and at a bounded pace (V29): a router restart, a phone that was unplugged or
 * a long Wi-Fi gap should heal itself, not leave a dead page that needs a tap. */
export function mayRetry(failure: ConnectionFailure): boolean {
  return failure !== 'authorization lost';
}

export class RetryGeneration {
  private value = 0;

  next(): number {
    this.value += 1;
    return this.value;
  }

  isCurrent(generation: number): boolean {
    return generation === this.value;
  }

  cancel(): void {
    this.value += 1;
  }
}
