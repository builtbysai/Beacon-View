import type { TalkState } from './talk';

/**
 * Announce on all cameras (ADR 0091). Each camera tile on the wall registers
 * its own talk session here. Announcing starts every eligible session, so
 * each camera still applies its normal rules: the viewer needs that camera's
 * Talk grant, only one person talks through a camera at a time, and the
 * camera still shows its "someone is talking" notice. Cameras that can't
 * take it right now are skipped, never forced.
 */
export interface AnnounceTarget {
  id: string;
  /** Connected, allowed to talk, and not paused. */
  eligible: boolean;
  start: () => void;
  stop: () => void;
  state: TalkState;
}

export class AnnounceRegistry {
  readonly #targets = new Map<string, AnnounceTarget>();
  readonly #listeners = new Set<() => void>();

  register(target: AnnounceTarget): () => void {
    this.#targets.set(target.id, target);
    this.#emit();
    return () => {
      if (this.#targets.get(target.id) === target)
        this.#targets.delete(target.id);
      this.#emit();
    };
  }

  /** Keeps a registered tile's latest state without re-registering. */
  update(target: AnnounceTarget): void {
    if (this.#targets.has(target.id)) {
      this.#targets.set(target.id, target);
      this.#emit();
    }
  }

  subscribe(listener: () => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  /** How many cameras an announcement would reach right now. */
  get reachable(): number {
    return [...this.#targets.values()].filter((target) => target.eligible)
      .length;
  }

  /** How many cameras are being talked through right now. */
  get speaking(): number {
    return [...this.#targets.values()].filter(
      (target) => target.state === 'speaking',
    ).length;
  }

  startAll(): number {
    let started = 0;
    for (const target of this.#targets.values()) {
      if (!target.eligible) continue;
      target.start();
      started += 1;
    }
    return started;
  }

  stopAll(): void {
    for (const target of this.#targets.values()) target.stop();
  }

  #emit(): void {
    for (const listener of this.#listeners) listener();
  }
}
