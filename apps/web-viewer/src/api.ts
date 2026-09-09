export function csrfToken(): string {
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
  const response = await fetch(path, {
    credentials: 'same-origin',
    ...options,
    headers: {
      ...(hasBody ? { 'content-type': 'application/json' } : {}),
      ...(options?.method && options.method !== 'GET'
        ? { 'x-csrf-token': csrfToken() }
        : {}),
      ...options?.headers,
    },
  });
  if (!response.ok) {
    const payload = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new Error(payload.error ?? 'Request failed');
  }
  return response.status === 204
    ? (undefined as T)
    : ((await response.json()) as T);
}
