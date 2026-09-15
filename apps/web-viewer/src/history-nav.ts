interface BeaconHistoryState {
  beaconDepth?: number;
}

// How deep the current entry sits in *this tab's* in-app navigation --
// separate from window.history.length, which also counts whatever the user
// visited before this app. Read straight from the current entry's own
// state every time, so it's correct even after a hard reload deep in the
// app, not just within one page's lifetime.
function currentDepth(): number {
  return (window.history.state as BeaconHistoryState | null)?.beaconDepth ?? 0;
}

/** Pushes a new in-app route, one step deeper than the current one. Use for
 * any navigation that should be a distinct "place" the user can return to
 * (opening a camera, switching pages, switching a settings section). */
export function pushRoute(url: string): void {
  window.history.pushState({ beaconDepth: currentDepth() + 1 }, '', url);
}

/** Replaces the current entry without adding a new one -- for normalizing
 * the current URL (redirects, cleanup) rather than moving somewhere new.
 * Carries the depth forward so it isn't lost from the replaced entry. */
export function replaceRoute(url: string): void {
  window.history.replaceState({ beaconDepth: currentDepth() }, '', url);
}

/** Goes back to wherever the user actually came from, when this tab's own
 * navigation has somewhere to go back to. Falls back instead of letting the
 * browser carry the user out of the app entirely -- the gap a plain
 * `history.back()` leaves open for a bookmarked or freshly opened deep
 * link with no in-app history behind it. */
export function goBack(fallback: () => void): void {
  if (currentDepth() > 0) window.history.back();
  else fallback();
}
