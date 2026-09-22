export interface BackendCapabilities {
  auth: { google: boolean };
  contact: boolean;
  googleDrive: boolean;
  notifications: {
    firebase: boolean;
    webPush: boolean;
  };
  realtime: boolean;
  recordings: boolean;
}

export function isBackendCapabilities(value: unknown): value is BackendCapabilities {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<BackendCapabilities>;
  return (
    typeof candidate.auth?.google === 'boolean' &&
    typeof candidate.contact === 'boolean' &&
    typeof candidate.notifications?.webPush === 'boolean'
  );
}
