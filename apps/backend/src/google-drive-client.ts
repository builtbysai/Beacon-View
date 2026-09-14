import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.appdata';
const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;

export async function driveProviderEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error('Google Drive API is unavailable');
  const payload = (await response.json()) as {
    user?: { emailAddress?: string };
  };
  return payload.user?.emailAddress ?? null;
}

export async function verifyDriveAppDataAccess(
  accessToken: string,
): Promise<void> {
  const parameters = new URLSearchParams({
    fields: 'files(id)',
    pageSize: '1',
    spaces: 'appDataFolder',
  });
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${parameters.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok) throw new Error('Google Drive app-data access unavailable');
}

export async function refreshDriveAccessToken(
  client: OAuth2Client,
  refreshToken: string,
): Promise<string> {
  client.setCredentials({ refresh_token: refreshToken });
  const token = await client.getAccessToken();
  if (!token.token) throw new Error('Google Drive access token unavailable');
  return token.token;
}

export async function revokeDriveRefreshToken(
  refreshToken: string,
): Promise<boolean> {
  const response = await fetch('https://oauth2.googleapis.com/revoke', {
    body: new URLSearchParams({ token: refreshToken }),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    method: 'POST',
    signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
  });
  return response.ok;
}
