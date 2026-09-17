import type {
  CameraMotionSettings,
  MotionSettings,
} from './motion-settings.js';
import type {
  NotificationDelivery,
  NotificationPreferenceRecord,
  NotificationSubscriptionInput,
  SecurityEventType,
} from './notification-types.js';
import type {
  RecordingDeletionClaim,
  RecordingRecord,
} from './recording-types.js';
import type { RecordingUploadClaim } from './recording-types.js';

export interface UserRecord {
  id: string;
  email: string;
  passwordHash: string | null;
  googleSubject: string | null;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  householdId: string;
}

export interface SessionRecord {
  id: string;
  userId: string;
  email: string;
  avatarUrl: string | null;
  householdId: string;
  ownedHouseholdId: string | null;
  role: 'owner' | 'admin' | 'viewer' | 'guest';
  tokenHash: string;
  csrfHash: string;
  reauthenticatedAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  revokedAt: Date | null;
}

export interface BrowserSessionRecord {
  id: string;
  createdAt: Date;
  lastSeenAt: Date;
  absoluteExpiresAt: Date;
  userAgent: string | null;
}

export interface HouseholdAccessRecord {
  householdId: string;
  name: string;
  role: 'owner' | 'admin' | 'viewer' | 'guest';
  expiresAt: Date | null;
}

export interface HouseholdMemberRecord {
  id: string;
  userId: string;
  email: string;
  role: SessionRecord['role'];
  status: 'active' | 'revoked';
  expiresAt: Date | null;
  grants: Array<{
    cameraId: string;
    cameraName: string;
    canListen: boolean;
    canTalk: boolean;
    canFlip: boolean;
    canPause: boolean;
  }>;
}

export interface HouseholdInvitationRecord {
  id: string;
  invitedEmail: string;
  role: Exclude<SessionRecord['role'], 'owner'>;
  expiresAt: Date;
  createdAt: Date;
  defaultCanListen: boolean;
  defaultCanTalk: boolean;
  defaultCanFlip: boolean;
  defaultCanPause: boolean;
}

export interface GoogleDriveConnectionRecord {
  providerEmail: string | null;
  scopes: string;
  updatedAt: Date;
}

/** A shareable link that grants anonymous, no-account access to specific
 * cameras -- the third kind of household access alongside signed-in
 * viewer/guest roles. See guest-routes.ts. */
export interface GuestLinkRecord {
  id: string;
  label: string | null;
  canListen: boolean;
  canTalk: boolean;
  canFlip: boolean;
  canPause: boolean;
  cameraIds: string[];
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
}

export interface CameraRecord {
  id: string;
  publicCameraId: string;
  deviceId: string;
  publicDeviceId: string;
  deviceName: string;
  platform: 'android' | 'browser';
  sourceKey: string;
  facing: 'front' | 'rear' | 'external' | 'unknown';
  enabled: boolean;
  privacyMode: boolean;
  name: string;
  lastSeenAt: Date | null;
  credentialRevokedAt: Date | null;
  capabilities: Record<string, boolean | number | string>;
  /** Whoever created the pairing code this camera's device redeemed, or
   * registered it directly (browser cameras). Null for cameras paired
   * before this was tracked, or whose pairer's account was later deleted --
   * either way, only an owner/admin can remove a camera with no pairer. */
  pairedByUserId: string | null;
}

/** A CameraRecord as returned by listAccessibleCameras: the viewer's own
 * grant permissions attached, true across the board for owner/admin. Not
 * present on the plain listCameras() result, which has no viewer context. */
export interface AccessibleCameraRecord extends CameraRecord {
  canListen: boolean;
  canTalk: boolean;
  canFlip: boolean;
  canPause: boolean;
}

export interface CameraIdentity {
  cameraId: string;
  deviceId: string;
  householdId: string;
  publicCameraId: string;
  publicDeviceId: string;
}

export interface CameraAccess extends CameraIdentity {
  canListen: boolean;
  canTalk: boolean;
  canFlip: boolean;
  canPause: boolean;
}

export interface DeviceRecord {
  id: string;
  publicDeviceId: string;
  name: string;
  platform: 'android' | 'browser';
  deviceType: string;
  lastSeenAt: Date | null;
  revokedAt: Date | null;
  softwareVersion: string | null;
  enabled: boolean;
  privacyMode: boolean;
  batteryPercent: number | null;
  batteryCharging: boolean | null;
  healthReportedAt: Date | null;
  capabilities: Record<string, boolean | number | string>;
  pairedByUserId: string | null;
}

export interface CameraSourceInput {
  sourceKey: string;
  name: string;
  facing: 'front' | 'rear' | 'external' | 'unknown';
  capabilities?: Record<string, boolean | number | string> | undefined;
}

export interface PairedDeviceRecord {
  id: string;
  publicDeviceId: string;
  publicCameraId: string;
  name: string;
}

export interface AuditInput {
  eventType: string;
  success: boolean;
  ipAddress?: string;
  userId?: string;
  householdId?: string;
  cameraId?: string;
  metadata?: Record<string, string>;
  /** Client-generated id shared across one continuous live-view attempt
   * (including its own automatic reconnects), so access-history can group
   * related rows without guessing from timestamps. */
  viewerSessionId?: string;
}

export interface AccessHistoryRecord {
  id: string;
  actorEmail: string | null;
  deviceName: string | null;
  eventType:
    | 'camera_source_deleted'
    | 'device_credential_revoked'
    | 'device_deleted'
    | 'device_self_removed'
    | 'live_view_started'
    | 'live_view_rejected'
    | 'privacy_disabled'
    | 'privacy_enabled';
  occurredAt: Date;
  success: boolean;
  viewerSessionId: string | null;
  metadata: Record<string, string>;
}

export interface AccessHistoryOptions {
  limit?: number;
  offset?: number;
}

export interface AccessHistoryPage {
  events: AccessHistoryRecord[];
  total: number;
}

export const HOUSEHOLD_ACTIVITY_EVENT_TYPES = [
  'camera_source_deleted',
  'device_credential_revoked',
  'device_deleted',
  'device_self_removed',
  'device_self_disconnected',
  'device_updated',
  'camera_updated',
  'household_invitation_created',
  'household_invitation_resent',
  'household_invitation_accepted',
  'household_invitation_revoked',
  'household_camera_grants_changed',
  'household_member_revoked',
  'household_member_removed',
  'camera_access_left',
  'recording_requested',
  'recording_deleted',
  'recording_available',
  'recording_failed',
  'live_view_started',
  'live_view_rejected',
  'privacy_disabled',
  'privacy_enabled',
  'motion_settings_changed',
  'motion_history_cleared',
  'motion_retention_changed',
  'notification_preference_changed',
  'notification_subscription_created',
  'notification_subscription_revoked',
] as const;

export type HouseholdActivityEventType =
  (typeof HOUSEHOLD_ACTIVITY_EVENT_TYPES)[number];

export interface HouseholdActivityRecord {
  id: string;
  actorEmail: string | null;
  deviceName: string | null;
  eventType: HouseholdActivityEventType;
  occurredAt: Date;
  success: boolean;
  metadata: Record<string, string>;
}

export interface HouseholdActivityOptions {
  limit?: number;
  offset?: number;
  eventTypes?: HouseholdActivityEventType[];
}

export interface HouseholdActivityPage {
  events: HouseholdActivityRecord[];
  total: number;
}

export interface MotionEventRecord {
  id: string;
  publicCameraId: string;
  cameraName: string;
  deviceName: string;
  confidence: number;
  occurredAt: Date;
  cursorTimestamp: string;
}

export interface MotionEventOptions {
  cameraId?: string;
  since?: string;
  before?: { time: string; id: string };
  limit?: number;
}

export const MOTION_RETENTION_DAYS = [1, 7, 30, 90] as const;
export type MotionRetentionDays = (typeof MOTION_RETENTION_DAYS)[number];

export interface MotionRetentionRecord {
  days: MotionRetentionDays;
}

export interface RetentionPurgeRecord {
  householdId: string;
  deletedCount: number;
}

export const DEVICE_REGISTRATION_RATE_LIMITED =
  'device_registration_rate_limited' as const;

export type PairingRedemptionResult =
  PairedDeviceRecord | null | typeof DEVICE_REGISTRATION_RATE_LIMITED;

export interface MilestoneStore {
  createRecordingRequest(input: {
    cameraSourceId: string;
    householdId: string;
    userId: string;
  }): Promise<RecordingRecord | null>;
  listRecordings(
    householdId: string,
    cameraSourceIds: string[],
  ): Promise<RecordingRecord[]>;
  deleteRecording(householdId: string, recordingId: string): Promise<boolean>;
  beginAvailableRecordingDeletion(
    householdId: string,
    recordingId: string,
  ): Promise<RecordingDeletionClaim | null>;
  finishRecordingDeletion(
    householdId: string,
    recordingId: string,
  ): Promise<boolean>;
  cancelRecordingDeletion(recordingId: string): Promise<void>;
  beginRecordingUpload(input: {
    byteSize: number;
    checksumSha256: string;
    credentialHash: string;
    durationMs: number;
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
  }): Promise<RecordingUploadClaim | null>;
  beginOwnerRecordingUpload(input: {
    byteSize: number;
    checksumSha256: string;
    durationMs: number;
    householdId: string;
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
    userId: string;
  }): Promise<RecordingUploadClaim | null>;
  getRecordingUploadClaim(
    userId: string,
    recordingId: string,
  ): Promise<RecordingUploadClaim | null>;
  getRecordingUploadClaimByCredential(
    credentialHash: string,
    recordingId: string,
  ): Promise<RecordingUploadClaim | null>;
  markRecordingUploadFailed(recordingId: string): Promise<void>;
  completeRecordingUpload(input: {
    recordingId: string;
    providerFileId: string;
    userId: string;
  }): Promise<boolean>;
  googleDriveConfigured(): boolean;
  getGoogleDriveConnection(
    userId: string,
  ): Promise<GoogleDriveConnectionRecord | null>;
  getGoogleDriveRefreshToken(userId: string): Promise<string | null>;
  saveGoogleDriveConnection(input: {
    providerEmail: string | null;
    refreshToken: string;
    scopes: string;
    userId: string;
  }): Promise<void>;
  removeGoogleDriveConnection(userId: string): Promise<boolean>;
  notificationsConfigured(): boolean;
  recordSecurityEvent(input: {
    userId: string;
    securityEventType: SecurityEventType;
    now: Date;
  }): Promise<void>;
  upsertNotificationSubscription(
    input: NotificationSubscriptionInput,
  ): Promise<string>;
  revokeNotificationSubscription(
    userId: string,
    sessionId: string,
    id: string,
  ): Promise<boolean>;
  listNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferenceRecord[]>;
  updateNotificationPreference(input: {
    userId: string;
    publicDeviceId: string;
    motionEnabled: boolean;
    offlineEnabled: boolean;
    quietHours: { start: string; end: string; timeZone: string } | null;
  }): Promise<NotificationPreferenceRecord | null>;
  scanNotificationPresence(now: Date, graceSeconds: number): Promise<void>;
  claimNotificationDeliveries(
    now: Date,
    limit?: number,
  ): Promise<NotificationDelivery[]>;
  markNotificationDelivered(
    id: string,
    subscriptionId: string,
    now: Date,
  ): Promise<void>;
  markNotificationFailed(
    id: string,
    subscriptionId: string,
    now: Date,
    permanent: boolean,
    retryAfterMs?: number,
  ): Promise<void>;
  isReady(): Promise<boolean>;
  listMotionSettings(
    householdId: string,
    publicDeviceId: string,
  ): Promise<CameraMotionSettings[]>;
  updateMotionSettings(
    householdId: string,
    publicCameraId: string,
    settings: MotionSettings,
  ): Promise<CameraMotionSettings | null>;
  close(): Promise<void>;
  createAccount(
    email: string,
    passwordHash: string,
    ipAddress: string,
  ): Promise<UserRecord>;
  createGoogleAccount(
    email: string,
    googleSubject: string,
    ipAddress: string,
    avatarUrl?: string | null,
  ): Promise<UserRecord>;
  updateGoogleAvatar(userId: string, avatarUrl: string): Promise<void>;
  linkGoogleAccount(
    userId: string,
    googleSubject: string,
    avatarUrl: string | null,
  ): Promise<void>;
  findUserByEmail(email: string): Promise<UserRecord | null>;
  findUserById(userId: string): Promise<UserRecord | null>;
  findUserByGoogleSubject(googleSubject: string): Promise<UserRecord | null>;
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  refreshReauthentication(sessionId: string): Promise<void>;
  revokeAllSessions(userId: string): Promise<string[]>;
  createEmailVerificationToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeEmailVerificationToken(
    tokenHash: string,
    now: Date,
  ): Promise<string | null>;
  createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void>;
  consumePasswordResetToken(
    tokenHash: string,
    now: Date,
  ): Promise<string | null>;
  createSession(input: {
    userId: string;
    householdId?: string;
    tokenHash: string;
    csrfHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    reauthenticatedAt?: Date;
    userAgent?: string | null | undefined;
  }): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<SessionRecord | null>;
  revokeSession(id: string): Promise<void>;
  listBrowserSessions(userId: string): Promise<BrowserSessionRecord[]>;
  listHouseholdAccess(
    userId: string,
    now: Date,
  ): Promise<HouseholdAccessRecord[]>;
  switchSessionHousehold(
    userId: string,
    sessionId: string,
    householdId: string,
    now: Date,
  ): Promise<boolean>;
  listHouseholdMembers(householdId: string): Promise<HouseholdMemberRecord[]>;
  listHouseholdInvitations(
    householdId: string,
    now: Date,
  ): Promise<HouseholdInvitationRecord[]>;
  createHouseholdInvitation(input: {
    householdId: string;
    invitedEmail: string;
    role: Exclude<SessionRecord['role'], 'owner'>;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
    defaultCanListen?: boolean;
    defaultCanTalk?: boolean;
    defaultCanFlip?: boolean;
    defaultCanPause?: boolean;
  }): Promise<string>;
  acceptHouseholdInvitation(input: {
    tokenHash: string;
    userId: string;
    email: string;
    now: Date;
  }): Promise<{
    householdId: string;
    role: Exclude<SessionRecord['role'], 'owner'>;
  } | null>;
  revokeHouseholdInvitation(
    householdId: string,
    invitationId: string,
  ): Promise<Exclude<SessionRecord['role'], 'owner'> | null>;
  replaceHouseholdMemberGrants(input: {
    householdId: string;
    memberId: string;
    grants: Array<{
      cameraId: string;
      canListen: boolean;
      canTalk: boolean;
      canFlip: boolean;
      canPause: boolean;
    }>;
  }): Promise<string[] | null>;
  revokeHouseholdMember(
    householdId: string,
    memberId: string,
  ): Promise<string[] | null>;
  permanentlyRemoveHouseholdMember(
    householdId: string,
    memberId: string,
  ): Promise<boolean>;
  leaveCamera(
    householdId: string,
    userId: string,
    publicCameraId: string,
  ): Promise<string[] | null>;
  createGuestLink(input: {
    householdId: string;
    tokenHash: string;
    label?: string;
    canListen: boolean;
    canTalk: boolean;
    canFlip: boolean;
    canPause: boolean;
    createdByUserId: string;
    expiresAt: Date;
    publicCameraIds: string[];
  }): Promise<string | null>;
  listGuestLinks(householdId: string, now: Date): Promise<GuestLinkRecord[]>;
  revokeGuestLink(householdId: string, guestLinkId: string): Promise<boolean>;
  /** For signaling: does this token grant access to exactly this camera,
   * and with what controls? Shaped like findAccessibleCamera's result on
   * purpose -- a guest link authorizes a live view the same way a
   * session's grant does, just without a user behind it. */
  findGuestAccessibleCamera(
    tokenHash: string,
    publicCameraId: string,
    now: Date,
  ): Promise<CameraAccess | null>;
  /** For the guest's own camera list: every camera the token covers,
   * presented exactly like listAccessibleCameras so the same
   * presentCamera() output shape works for both. */
  listGuestAccessibleCameras(
    tokenHash: string,
    now: Date,
  ): Promise<{ householdId: string; cameras: AccessibleCameraRecord[] } | null>;
  revokeBrowserSession(userId: string, sessionId: string): Promise<boolean>;
  deleteAccount(userId: string): Promise<boolean>;
  audit(input: AuditInput): Promise<void>;
  purgeExpiredAuditEvents(now: Date): Promise<number>;
  listAccessHistory(
    householdId: string,
    options?: AccessHistoryOptions,
  ): Promise<AccessHistoryPage>;
  listHouseholdActivity(
    householdId: string,
    options?: HouseholdActivityOptions,
  ): Promise<HouseholdActivityPage>;
  listMotionEvents(
    householdId: string,
    options?: MotionEventOptions,
  ): Promise<MotionEventRecord[]>;
  getMotionRetention(
    householdId: string,
  ): Promise<MotionRetentionRecord | null>;
  updateMotionRetention(
    householdId: string,
    days: MotionRetentionDays,
  ): Promise<MotionRetentionRecord | null>;
  purgeExpiredMotionEvents(now: Date): Promise<RetentionPurgeRecord[]>;
  clearMotionEvents(householdId: string): Promise<number>;
  createMotionEvent(input: {
    credentialHash: string;
    publicCameraId: string;
    confidence: number;
    now: Date;
  }): Promise<{
    created: boolean;
    householdId: string;
    cameraSourceId: string;
    ownerId: string;
    recordOnMotion: boolean;
  } | null>;
  /** Best-effort: starts a recording for a motion-triggered camera, when the
   * household owner has Drive's recording scope connected and this camera
   * doesn't already have one in flight. Returns null (never throws) when
   * either isn't true -- a missed auto-recording is not a motion-reporting
   * failure. */
  createMotionTriggeredRecording(input: {
    cameraSourceId: string;
    householdId: string;
    ownerId: string;
  }): Promise<{ recordingId: string } | null>;
  createPairingCode(
    householdId: string,
    codeHash: string,
    expiresAt: Date,
    targetDeviceId?: string,
    createdByUserId?: string,
  ): Promise<string>;
  revokePairingCode(
    householdId: string,
    pairingCodeId: string,
  ): Promise<boolean>;
  redeemPairingCode(input: {
    codeHash: string;
    credentialHash: string;
    installationId: string;
    name: string;
    ipAddress: string;
    now: Date;
  }): Promise<PairingRedemptionResult>;
  listCameras(householdId: string): Promise<CameraRecord[]>;
  listDevices(householdId: string): Promise<DeviceRecord[]>;
  listAccessibleCameras(
    householdId: string,
    userId: string,
    role: SessionRecord['role'],
  ): Promise<AccessibleCameraRecord[]>;
  listAccessibleDevices(
    householdId: string,
    userId: string,
    role: SessionRecord['role'],
  ): Promise<DeviceRecord[]>;
  syncDeviceCameras(
    credentialHash: string,
    sources: CameraSourceInput[],
    now: Date,
  ): Promise<CameraRecord[] | null>;
  registerBrowserDevice(input: {
    householdId: string;
    installationId: string;
    name: string;
    sources: CameraSourceInput[];
    now: Date;
    createdByUserId?: string;
  }): Promise<{ device: DeviceRecord; cameras: CameraRecord[] }>;
  updateDevice(
    householdId: string,
    publicDeviceId: string,
    changes: { enabled?: boolean | undefined; name?: string | undefined },
  ): Promise<boolean>;
  setPrivacyMode(
    householdId: string,
    publicDeviceId: string,
    enabled: boolean,
  ): Promise<string | null>;
  updateCamera(
    householdId: string,
    publicCameraId: string,
    changes: {
      enabled?: boolean | undefined;
      name?: string | undefined;
    },
  ): Promise<boolean>;
  heartbeat(
    credentialHash: string,
    now: Date,
    health?: { batteryPercent: number; batteryCharging: boolean },
  ): Promise<string | null>;
  revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null>;
  deleteDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null>;
  deleteCamera(householdId: string, publicCameraId: string): Promise<boolean>;
  findDeviceByCredential(
    credentialHash: string,
  ): Promise<CameraIdentity | null>;
  findCameraForDeviceCredential(
    credentialHash: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null>;
  findOwnedCamera(
    householdId: string,
    publicDeviceId: string,
  ): Promise<CameraIdentity | null>;
  findAccessibleCamera(
    householdId: string,
    userId: string,
    role: SessionRecord['role'],
    publicCameraId: string,
  ): Promise<CameraAccess | null>;
  findManagedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null>;
}
