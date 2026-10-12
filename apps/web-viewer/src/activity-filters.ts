export function localActivityDate(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/** A date filter begins at midnight in the viewer's local timezone. */
export function activityDateStart(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00`);
  if (!Number.isFinite(date.getTime()) || localActivityDate(date) !== value)
    return null;
  return date.toISOString();
}

export function activitySince(
  period: string,
  date: string,
  now = Date.now(),
): string | null {
  if (period === 'all') return null;
  if (period === 'since') return activityDateStart(date);
  const days = period === '30' ? 30 : period === '7' ? 7 : 1;
  return new Date(now - days * 86_400_000).toISOString();
}

/**
 * The Activity timeline merges two feeds that page independently (motion events by cursor, household events by
 * offset), so one can be several pages ahead of the other. Events older than the oldest event of a feed that still
 * has more to load could be missing neighbours from that feed, so they stay hidden until it catches up (V79).
 * [feeds] says, for each feed, whether it has more pages and which of the loaded events belong to it.
 */
export function completeThroughEvents<T extends { occurredAt: string }>(
  events: readonly T[],
  feeds: readonly { hasMore: boolean; belongs: (event: T) => boolean }[],
): T[] {
  let cutoff = -Infinity;
  for (const feed of feeds) {
    if (!feed.hasMore) continue;
    let oldest = Infinity;
    for (const event of events) {
      if (feed.belongs(event))
        oldest = Math.min(oldest, new Date(event.occurredAt).getTime());
    }
    if (Number.isFinite(oldest)) cutoff = Math.max(cutoff, oldest);
  }
  if (cutoff === -Infinity) return [...events];
  return events.filter(
    (event) => new Date(event.occurredAt).getTime() >= cutoff,
  );
}
