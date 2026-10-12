import { friendlyServerError, statusMessage } from './friendly-errors';

/** A failed Beacon API call. `message` is written for people (ADR 0087).
 * `status` is 0 when Beacon could not be reached at all (offline, DNS,
 * timeout). `code` is the machine-readable reason when there is one (e.g.
 * `drive_reconnect_required`), and `serverMessage` the server's original
 * text, for logs and support -- never compare display text. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
    readonly requestId?: string,
    readonly serverMessage?: string,
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

function csrfToken(): string {
  return (
    document.cookie
      .split('; ')
      .find((value) => value.startsWith('beacon_csrf='))
      ?.split('=')[1] ?? ''
  );
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
    const serverMessage =
      typeof payload.error === 'string' && payload.error
        ? payload.error
        : undefined;
    const friendly = friendlyServerError(
      response.status,
      serverMessage,
      typeof payload.code === 'string' ? payload.code : undefined,
    );
    if (friendly.code === 'session_required' && typeof window !== 'undefined')
      window.dispatchEvent(new Event(SESSION_ENDED_EVENT));
    throw new ApiError(
      friendly.message || statusMessage(response.status),
      response.status,
      friendly.code,
      typeof payload.requestId === 'string' ? payload.requestId : undefined,
      serverMessage,
    );
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
