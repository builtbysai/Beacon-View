export const MAX_AUTOMATIC_RETRIES = 5;

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

export function mayRetry(failure: ConnectionFailure, attempt: number): boolean {
  return (
    attempt < MAX_AUTOMATIC_RETRIES &&
    failure !== 'authorization lost' &&
    failure !== 'camera offline'
  );
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
