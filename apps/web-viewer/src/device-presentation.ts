export function relativeLastSeen(
  value: string | null,
  now = Date.now(),
): string {
  if (!value) return 'Never';
  const observedAt = new Date(value);
  const elapsed = now - observedAt.getTime();
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} min ago`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} hr ago`;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
    observedAt,
  );
}

export function capabilitySummary(
  capabilities: Record<string, boolean | number | string> | undefined,
): string {
  if (!capabilities || Object.keys(capabilities).length === 0)
    return 'Standard video';
  return Object.entries(capabilities)
    .filter(([, value]) => value !== false)
    .map(([key, value]) =>
      value === true
        ? key.replaceAll('_', ' ')
        : `${key.replaceAll('_', ' ')}: ${String(value)}`,
    )
    .join(' · ');
}
