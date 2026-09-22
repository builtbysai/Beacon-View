/**
 * Home's "Favorites" are a per-browser preference, not a synced backend
 * feature -- there is no household/camera favorites table or API yet.
 * Persisting the choice in localStorage, scoped per household, is a real
 * working feature (it survives reloads and is honestly local-only) rather
 * than a fake backend. Making favorites sync across devices would need a
 * schema change (e.g. a `camera_favorites` table keyed by user + camera)
 * and a small CRUD endpoint; worth doing if favorites prove useful, but
 * out of scope for this pass.
 */

const STORAGE_PREFIX = 'beacon.favorites.';

/** `null` means the household has no saved preference yet -- the caller
 * should fall back to a sensible default rather than showing "no
 * favorites". An explicit `[]` means the person cleared every favorite. */
export function loadFavoriteDeviceIds(householdId: string): string[] | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + householdId);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((value): value is string => typeof value === 'string');
  } catch {
    return null;
  }
}

export function saveFavoriteDeviceIds(
  householdId: string,
  deviceIds: string[],
): void {
  try {
    window.localStorage.setItem(
      STORAGE_PREFIX + householdId,
      JSON.stringify(deviceIds),
    );
  } catch {
    // Favorites remain usable in memory when storage is unavailable.
  }
}
