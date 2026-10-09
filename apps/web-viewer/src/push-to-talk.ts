/**
 * Hold-to-talk (ADR 0090). One control does both jobs people expect:
 * - tap: talking turns on and stays on until tapped again (the original way)
 * - hold: talking lasts only while the button or key is held
 *
 * A press that lasts at least `HOLD_MS` is a hold. Release then ends the
 * talk. A shorter press leaves it on.
 */
export const HOLD_MS = 400;

export class PushToTalk {
  #pressedAt: number | null = null;
  #startedByPress = false;

  constructor(
    private readonly talking: () => boolean,
    private readonly start: () => void,
    private readonly stop: () => void,
    private readonly now: () => number = Date.now,
  ) {}

  /** The button or key went down. */
  press(): void {
    if (this.#pressedAt !== null) return;
    this.#pressedAt = this.now();
    if (this.talking()) {
      // Pressing while talking ends it (tap to stop).
      this.#startedByPress = false;
      this.stop();
      return;
    }
    this.#startedByPress = true;
    this.start();
  }

  /** The button or key came up (or the pointer left, or was cancelled). */
  release(): void {
    const pressedAt = this.#pressedAt;
    this.#pressedAt = null;
    if (pressedAt === null || !this.#startedByPress) return;
    this.#startedByPress = false;
    if (this.now() - pressedAt >= HOLD_MS) this.stop();
  }
}
