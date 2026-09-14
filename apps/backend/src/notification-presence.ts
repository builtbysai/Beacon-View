export const CAMERA_ONLINE_WINDOW_MS = 90_000;

export function offlineCandidateSince(lastSeenAt: Date): Date {
  return new Date(lastSeenAt.getTime() + CAMERA_ONLINE_WINDOW_MS);
}

export function offlineGraceElapsed(
  candidateSince: Date,
  now: Date,
  graceSeconds: number,
): boolean {
  return now.getTime() >= candidateSince.getTime() + graceSeconds * 1_000;
}
