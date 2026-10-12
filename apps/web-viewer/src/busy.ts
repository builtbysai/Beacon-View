/** Things a page is doing that a reload would interrupt (a live view, an open camera, a clip being recorded or
 * uploaded). The update manager waits for none of them to be running before it reloads a hidden page (ADR 0118). */
const busy = new Map<symbol, string>();

export function markBusy(reason: string): () => void {
  const key = Symbol(reason);
  busy.set(key, reason);
  return () => void busy.delete(key);
}

export function isBusy(): boolean {
  return busy.size > 0;
}
