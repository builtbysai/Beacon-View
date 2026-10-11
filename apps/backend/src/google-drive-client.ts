import { OAuth2Client } from 'google-auth-library';

export const GOOGLE_DRIVE_SCOPE =
  'https://www.googleapis.com/auth/drive.appdata';
export const GOOGLE_DRIVE_RECORDING_SCOPE =
  'https://www.googleapis.com/auth/drive.file';
const GOOGLE_REQUEST_TIMEOUT_MS = 10_000;

/** Google rejected the stored refresh token: it expired (an OAuth app whose
 * consent screen is still in "Testing" issues tokens that expire after 7
 * days), was revoked, or the account password changed. Only a new consent
 * fixes it, so callers drop the connection and ask the owner to reconnect. */
export class DriveReconnectRequiredError extends Error {
  constructor() {
    super('Google Drive needs to be reconnected');
    this.name = 'DriveReconnectRequiredError';
  }
}

export function isInvalidGrant(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const data = (error as { response?: { data?: { error?: unknown } } }).response
    ?.data;
  return (
    data?.error === 'invalid_grant' ||
    (error instanceof Error && /\binvalid_grant\b/u.test(error.message))
  );
}

export class GoogleDriveRequestError extends Error {
  constructor(
    readonly operation:
      | 'app_data_list'
      | 'provider_identity'
      | 'recording_file_list'
      | 'recording_file_verify'
      | 'recording_file_delete'
      | 'recording_file_download'
      | 'recording_upload_start',
    readonly status: number,
  ) {
    super(`Google Drive request failed during ${operation}`);
    this.name = 'GoogleDriveRequestError';
  }
}

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
  if (!response.ok)
    throw new GoogleDriveRequestError('provider_identity', response.status);
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
  if (!response.ok)
    throw new GoogleDriveRequestError('app_data_list', response.status);
}

export async function verifyDriveRecordingAccess(
  accessToken: string,
): Promise<void> {
  const parameters = new URLSearchParams({
    fields: 'files(id)',
    pageSize: '1',
    q: "appProperties has { key='beacon' and value='recording' }",
  });
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?${parameters.toString()}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new GoogleDriveRequestError('recording_file_list', response.status);
}

export async function initiateDriveRecordingUpload(input: {
  accessToken: string;
  byteSize: number;
  mimeType: 'application/octet-stream';
  origin?: string;
  /** A thumbnail gets its own file name and marker so it is not mistaken for the clip in the owner's Drive. */
  part?: 'thumbnail';
  recordingId: string;
}): Promise<string> {
  const parameters = new URLSearchParams({
    fields: 'id',
    uploadType: 'resumable',
  });
  const response = await fetch(
    `https://www.googleapis.com/upload/drive/v3/files?${parameters.toString()}`,
    {
      body: JSON.stringify({
        appProperties: {
          beacon: 'recording',
          ...(input.part ? { part: input.part } : {}),
          recordingId: input.recordingId,
        },
        mimeType: input.mimeType,
        name: `Beacon-${input.part ?? 'recording'}-${input.recordingId}.beacon`,
      }),
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        'Content-Type': 'application/json; charset=UTF-8',
        'X-Upload-Content-Length': String(input.byteSize),
        'X-Upload-Content-Type': input.mimeType,
        ...(input.origin ? { Origin: input.origin } : {}),
      },
      method: 'POST',
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new GoogleDriveRequestError(
      'recording_upload_start',
      response.status,
    );
  const location = response.headers.get('location');
  if (!location) throw new Error('Google Drive upload session unavailable');
  const uploadUrl = new URL(location);
  if (
    uploadUrl.protocol !== 'https:' ||
    uploadUrl.hostname !== 'www.googleapis.com'
  )
    throw new Error('Google Drive returned an invalid upload session');
  return uploadUrl.toString();
}

export async function verifyDriveRecordingFile(input: {
  accessToken: string;
  byteSize: number;
  mimeType: 'application/octet-stream';
  providerFileId: string;
  recordingId: string;
}): Promise<void> {
  const parameters = new URLSearchParams({
    fields: 'id,size,mimeType,appProperties,trashed',
  });
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(input.providerFileId)}?${parameters.toString()}`,
    {
      headers: { Authorization: `Bearer ${input.accessToken}` },
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok)
    throw new GoogleDriveRequestError('recording_file_verify', response.status);
  const file = (await response.json()) as {
    appProperties?: Record<string, string>;
    id?: string;
    mimeType?: string;
    size?: string;
    trashed?: boolean;
  };
  if (
    file.id !== input.providerFileId ||
    file.trashed === true ||
    file.mimeType !== input.mimeType ||
    file.size !== String(input.byteSize) ||
    file.appProperties?.beacon !== 'recording' ||
    file.appProperties.recordingId !== input.recordingId
  )
    throw new Error('Google Drive recording metadata did not match');
}

export async function deleteDriveRecordingFile(
  accessToken: string,
  providerFileId: string,
): Promise<void> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(providerFileId)}`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      method: 'DELETE',
      signal: AbortSignal.timeout(GOOGLE_REQUEST_TIMEOUT_MS),
    },
  );
  if (!response.ok && response.status !== 404)
    throw new GoogleDriveRequestError('recording_file_delete', response.status);
}

/** Returns ciphertext as a stream; callers must not buffer it on the VM. */
export async function downloadDriveRecordingFile(
  accessToken: string,
  providerFileId: string,
): Promise<Response> {
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(providerFileId)}?alt=media`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(5 * 60_000),
    },
  );
  if (!response.ok || !response.body)
    throw new GoogleDriveRequestError(
      'recording_file_download',
      response.status,
    );
  return response;
}

export async function refreshDriveAccessToken(
  client: OAuth2Client,
  refreshToken: string,
): Promise<string> {
  client.setCredentials({ refresh_token: refreshToken });
  try {
    const token = await client.getAccessToken();
    if (!token.token) throw new Error('Google Drive access token unavailable');
    return token.token;
  } catch (error) {
    if (isInvalidGrant(error)) throw new DriveReconnectRequiredError();
    throw error;
  }
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
