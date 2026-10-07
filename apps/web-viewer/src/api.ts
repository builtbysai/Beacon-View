/** A failed Beacon API call. `status` is 0 when Beacon could not be reached
 * at all (offline, DNS, timeout). `code` is the server's machine-readable
 * reason when it sent one (e.g. `drive_reconnect_required`). */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** Beacon was unreachable; retrying later may work. */
  get network(): boolean {
    return this.status === 0;
  }
}

/** Fired on `window` when a request finds the session has ended, so the app
 * can return to sign-in once instead of every screen showing its own
 * "Authentication required". */
export const SESSION_ENDED_EVENT = 'beacon:session-ended';

const NETWORK_MESSAGE =
  'Can’t reach Beacon. Check your internet connection and try again.';
const TIMEOUT_MESSAGE = 'Beacon took too long to respond. Try again.';
/** Ordinary API calls give up after this long; uploads use their own path. */
const REQUEST_TIMEOUT_MS = 60_000;

export function csrfToken(): string {
  return (
    document.cookie
      .split('; ')
      .find((value) => value.startsWith('beacon_csrf='))
      ?.split('=')[1] ?? ''
  );
}

/** A plain message for a failed response that carried none. */
export function fallbackMessage(status: number): string {
  if (status === 401) return 'Please sign in again.';
  if (status === 403) return 'You don’t have access to do that.';
  if (status === 404) return 'That item no longer exists.';
  if (status === 409)
    return 'That changed in the meantime. Refresh and try again.';
  if (status === 413) return 'That is too large to send.';
  if (status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (status >= 500)
    return 'Beacon is having trouble right now. Try again in a moment.';
  return 'That request didn’t work. Try again.';
}

/** The message to show for any caught error, preferring Beacon's own. */
export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

export async function request<T>(
  path: string,
  options?: RequestInit,
): Promise<T> {
  const hasBody = options?.body !== undefined && options.body !== null;
  const cache =
    options?.cache ??
    (!options?.method || options.method === 'GET' ? 'no-store' : null);
  const timeout = AbortSignal.timeout?.(REQUEST_TIMEOUT_MS);
  const signal =
    options?.signal && timeout && 'any' in AbortSignal
      ? AbortSignal.any([options.signal, timeout])
      : (options?.signal ?? timeout);
  let response: Response;
  try {
    response = await fetch(path, {
      ...(cache ? { cache } : {}),
      credentials: 'same-origin',
      ...options,
      ...(signal ? { signal } : {}),
      headers: {
        ...(hasBody ? { 'content-type': 'application/json' } : {}),
        ...(options?.method && options.method !== 'GET'
          ? { 'x-csrf-token': csrfToken() }
          : {}),
        ...options?.headers,
      },
    });
  } catch (error) {
    // The caller cancelled: pass that through untouched.
    if (options?.signal?.aborted) throw error;
    throw new ApiError(
      timeout?.aborted ? TIMEOUT_MESSAGE : NETWORK_MESSAGE,
      0,
      timeout?.aborted ? 'timeout' : 'network',
    );
  }
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      code?: unknown;
      error?: unknown;
      requestId?: unknown;
    };
    const code = typeof payload.code === 'string' ? payload.code : undefined;
    if (code === 'session_required' && typeof window !== 'undefined')
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    throw new ApiError(
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : fallbackMessage(response.status),
      response.status,
      code,
      typeof payload.requestId === 'string' ? payload.requestId : undefined,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
