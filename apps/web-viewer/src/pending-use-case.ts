import type { CameraUseCase } from './camera-use-case';

/**
 * The use case chosen while creating a computer camera setup, held until
 * that camera pairs (the realtime `camera-paired` event) and then applied
 * to it. It expires with the pairing code it was chosen for.
 */
const KEY = 'beacon.pending-camera-use-case.v1';

export function rememberPendingUseCase(
  useCase: CameraUseCase,
  expiresAt: string,
): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ expiresAt, useCase }));
  } catch {
    // The owner can still choose the use case later in camera settings.
  }
}

export function takePendingUseCase(now = Date.now()): CameraUseCase | null {
  try {
    const raw = localStorage.getItem(KEY);
    localStorage.removeItem(KEY);
    if (!raw) return null;
    const { expiresAt, useCase } = JSON.parse(raw) as {
      expiresAt?: unknown;
      useCase?: unknown;
    };
    if (typeof expiresAt !== 'string' || Date.parse(expiresAt) <= now)
      return null;
    return useCase === 'security' ||
      useCase === 'baby' ||
      useCase === 'doorbell' ||
      useCase === 'general'
      ? useCase
      : null;
  } catch {
    return null;
  }
}
