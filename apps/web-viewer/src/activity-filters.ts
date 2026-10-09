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
