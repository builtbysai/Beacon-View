import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.appdata';

export async function driveProviderEmail(
  accessToken: string,
): Promise<string | null> {
  const response = await fetch(
    'https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)',
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!response.ok) return null;
  const payload = (await response.json()) as {
    user?: { emailAddress?: string };
  };
  return payload.user?.emailAddress ?? null;
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
