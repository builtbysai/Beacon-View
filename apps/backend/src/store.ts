import { Pool } from 'pg';
import {
  type CameraMotionSettings,
  type MotionSettings,
} from './motion-settings.js';
import { PostgresMotionRepository } from './postgres-motion-repository.js';
import { PostgresAuditRepository } from './postgres-audit-repository.js';
import { PostgresAccountRepository } from './postgres-account-repository.js';
import { PostgresDeviceRepository } from './postgres-device-repository.js';
import { PostgresPairingRepository } from './postgres-pairing-repository.js';
import { PostgresSessionRepository } from './postgres-session-repository.js';
import { PostgresNotificationRepository } from './postgres-notification-repository.js';
import { PostgresSharingRepository } from './postgres-sharing-repository.js';
import { NotificationCipher } from './notification-crypto.js';
import { GoogleDriveTokenCipher } from './google-drive-crypto.js';
import { PostgresGoogleDriveRepository } from './postgres-google-drive-repository.js';
import { PostgresRecordingRepository } from './postgres-recording-repository.js';
import { PostgresAccountRecoveryRepository } from './postgres-account-recovery-repository.js';
import type {
  RecordingDeletionClaim,
  RecordingRecord,
  RecordingUploadClaim,
} from './recording-types.js';
import type {
  NotificationDelivery,
  NotificationPreferenceRecord,
  NotificationSubscriptionInput,
  SecurityEventType,
} from './notification-types.js';
import {
  type AccessHistoryRecord,
  type AuditInput,
  type BrowserSessionRecord,
  type CameraIdentity,
  type CameraAccess,
  type CameraRecord,
  type CameraSourceInput,
  type DeviceRecord,
  type MilestoneStore,
  type MotionEventOptions,
  type MotionEventRecord,
  type MotionRetentionDays,
  type MotionRetentionRecord,
  type PairingRedemptionResult,
  type RetentionPurgeRecord,
  type SessionRecord,
  type HouseholdAccessRecord,
  type HouseholdInvitationRecord,
  type HouseholdMemberRecord,
  type GoogleDriveConnectionRecord,
  type UserRecord,
} from './store-contract.js';

export * from './store-contract.js';

export class PostgresStore implements MilestoneStore {
  readonly pool: Pool;
  private readonly auditRepository: PostgresAuditRepository;
  private readonly accounts: PostgresAccountRepository;
  private readonly devices: PostgresDeviceRepository;
  private readonly motion: PostgresMotionRepository;
  private readonly pairing: PostgresPairingRepository;
  private readonly sessions: PostgresSessionRepository;
  private readonly sharing: PostgresSharingRepository;
  private readonly notifications: PostgresNotificationRepository;
  private readonly googleDrive: PostgresGoogleDriveRepository;
  private readonly recordings: PostgresRecordingRepository;
  private readonly accountRecovery: PostgresAccountRecoveryRepository;

  constructor(
    databaseUrl: string,
    notificationKeys?: { encryptionKey: string; fingerprintKey: string },
    googleDriveTokenEncryptionKey?: string,
  ) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
    this.notifications = new PostgresNotificationRepository(
      this.pool,
      notificationKeys
        ? new NotificationCipher(
            notificationKeys.encryptionKey,
            notificationKeys.fingerprintKey,
          )
        : null,
    );
    this.googleDrive = new PostgresGoogleDriveRepository(
      this.pool,
      googleDriveTokenEncryptionKey
        ? new GoogleDriveTokenCipher(googleDriveTokenEncryptionKey)
        : null,
    );
    this.recordings = new PostgresRecordingRepository(this.pool);
    this.accountRecovery = new PostgresAccountRecoveryRepository(this.pool);
    this.auditRepository = new PostgresAuditRepository(this.pool);
    this.accounts = new PostgresAccountRepository(
      this.pool,
      this.auditRepository,
    );
    this.devices = new PostgresDeviceRepository(this.pool);
    this.motion = new PostgresMotionRepository(this.pool, this.notifications);
    this.pairing = new PostgresPairingRepository(
      this.pool,
      this.auditRepository,
    );
    this.sessions = new PostgresSessionRepository(
      this.pool,
      this.notifications,
    );
    this.sharing = new PostgresSharingRepository(this.pool);
  }

  notificationsConfigured(): boolean {
    return this.notifications.configured;
  }

  async recordSecurityEvent(input: {
    userId: string;
    securityEventType: SecurityEventType;
    now: Date;
  }): Promise<void> {
    await this.notifications.recordSecurityEvent(input);
  }

  googleDriveConfigured(): boolean {
    return this.googleDrive.configured;
  }

  async createRecordingRequest(input: {
    cameraSourceId: string;
    householdId: string;
    userId: string;
  }): Promise<RecordingRecord | null> {
    return this.recordings.createRequested(input);
  }

  async listRecordings(
    householdId: string,
    cameraSourceIds: string[],
  ): Promise<RecordingRecord[]> {
    return this.recordings.listForCameraSources(householdId, cameraSourceIds);
  }

  async deleteRecording(
    householdId: string,
    recordingId: string,
  ): Promise<boolean> {
    return this.recordings.markDeleted(householdId, recordingId);
  }

  async beginAvailableRecordingDeletion(
    householdId: string,
    recordingId: string,
  ): Promise<RecordingDeletionClaim | null> {
    return this.recordings.beginAvailableDeletion(householdId, recordingId);
  }

  async finishRecordingDeletion(
    householdId: string,
    recordingId: string,
  ): Promise<boolean> {
    return this.recordings.finishDeletion(householdId, recordingId);
  }

  async cancelRecordingDeletion(recordingId: string): Promise<void> {
    await this.recordings.cancelDeletion(recordingId);
  }

  async beginRecordingUpload(input: {
    byteSize: number;
    checksumSha256: string;
    credentialHash: string;
    durationMs: number;
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
  }): Promise<RecordingUploadClaim | null> {
    return this.recordings.beginUpload(input);
  }

  async beginOwnerRecordingUpload(input: {
    byteSize: number;
    checksumSha256: string;
    durationMs: number;
    householdId: string;
    mimeType: 'video/mp4' | 'video/webm';
    recordingId: string;
    userId: string;
  }): Promise<RecordingUploadClaim | null> {
    return this.recordings.beginOwnerUpload(input);
  }

  async getRecordingUploadClaim(
    userId: string,
    recordingId: string,
  ): Promise<RecordingUploadClaim | null> {
    return this.recordings.getUploadClaim(userId, recordingId);
  }

  async getRecordingUploadClaimByCredential(
    credentialHash: string,
    recordingId: string,
  ): Promise<RecordingUploadClaim | null> {
    return this.recordings.getUploadClaimByCredential(
      credentialHash,
      recordingId,
    );
  }

  async markRecordingUploadFailed(recordingId: string): Promise<void> {
    await this.recordings.markUploadFailed(recordingId);
  }

  async completeRecordingUpload(input: {
    recordingId: string;
    providerFileId: string;
    userId: string;
  }): Promise<boolean> {
    return this.recordings.completeUpload(input);
  }

  async getGoogleDriveConnection(
    userId: string,
  ): Promise<GoogleDriveConnectionRecord | null> {
    return this.googleDrive.get(userId);
  }

  async getGoogleDriveRefreshToken(userId: string): Promise<string | null> {
    return this.googleDrive.getRefreshToken(userId);
  }

  async saveGoogleDriveConnection(input: {
    providerEmail: string | null;
    refreshToken: string;
    scopes: string;
    userId: string;
  }): Promise<void> {
    await this.googleDrive.upsert(input);
  }

  async removeGoogleDriveConnection(userId: string): Promise<boolean> {
    return this.googleDrive.remove(userId);
  }

  async upsertNotificationSubscription(
    input: NotificationSubscriptionInput,
  ): Promise<string> {
    return this.notifications.upsertSubscription(input);
  }

  async revokeNotificationSubscription(
    userId: string,
    sessionId: string,
    id: string,
  ): Promise<boolean> {
    return this.notifications.revokeSubscription(userId, sessionId, id);
  }

  async listNotificationPreferences(
    userId: string,
  ): Promise<NotificationPreferenceRecord[]> {
    return this.notifications.listPreferences(userId);
  }

  async updateNotificationPreference(input: {
    userId: string;
    publicDeviceId: string;
    motionEnabled: boolean;
    offlineEnabled: boolean;
    quietHours: { start: string; end: string; timeZone: string } | null;
  }): Promise<NotificationPreferenceRecord | null> {
    return this.notifications.updatePreference(input);
  }

  async scanNotificationPresence(
    now: Date,
    graceSeconds: number,
  ): Promise<void> {
    await this.notifications.scanPresence(now, graceSeconds);
  }

  async claimNotificationDeliveries(
    now: Date,
    limit = 20,
  ): Promise<NotificationDelivery[]> {
    return this.notifications.claimDeliveries(now, limit);
  }

  async markNotificationDelivered(
    id: string,
    subscriptionId: string,
    now: Date,
  ): Promise<void> {
    await this.notifications.markDelivered(id, subscriptionId, now);
  }

  async markNotificationFailed(
    id: string,
    subscriptionId: string,
    now: Date,
    permanent: boolean,
    retryAfterMs?: number,
  ): Promise<void> {
    await this.notifications.markFailed(
      id,
      subscriptionId,
      now,
      permanent,
      retryAfterMs,
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  async isReady(): Promise<boolean> {
    await this.pool.query('SELECT 1');
    return true;
  }

  async createAccount(
    email: string,
    passwordHash: string,
    ipAddress: string,
  ): Promise<UserRecord> {
    return this.accounts.createWithPassword(email, passwordHash, ipAddress);
  }

  async findUserByEmail(email: string): Promise<UserRecord | null> {
    return this.accounts.findByEmail(email);
  }

  async findUserById(userId: string): Promise<UserRecord | null> {
    return this.accounts.findById(userId);
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.accounts.updatePassword(userId, passwordHash);
  }

  async createGoogleAccount(
    email: string,
    googleSubject: string,
    ipAddress: string,
    avatarUrl: string | null = null,
  ): Promise<UserRecord> {
    return this.accounts.createWithGoogle(
      email,
      googleSubject,
      ipAddress,
      avatarUrl,
    );
  }

  async updateGoogleAvatar(userId: string, avatarUrl: string): Promise<void> {
    await this.accounts.updateGoogleAvatar(userId, avatarUrl);
  }

  async findUserByGoogleSubject(
    googleSubject: string,
  ): Promise<UserRecord | null> {
    return this.accounts.findByGoogleSubject(googleSubject);
  }

  async createSession(input: {
    userId: string;
    householdId?: string;
    tokenHash: string;
    csrfHash: string;
    idleExpiresAt: Date;
    absoluteExpiresAt: Date;
    reauthenticatedAt?: Date;
    userAgent?: string | null | undefined;
  }): Promise<void> {
    await this.sessions.create(input);
  }

  async findSession(
    tokenHash: string,
    now: Date,
  ): Promise<SessionRecord | null> {
    return this.sessions.findActive(tokenHash, now);
  }

  async revokeSession(id: string): Promise<void> {
    await this.sessions.revoke(id);
  }

  async refreshReauthentication(sessionId: string): Promise<void> {
    await this.sessions.refreshReauthentication(sessionId);
  }

  async revokeAllSessions(userId: string): Promise<string[]> {
    return this.sessions.revokeAllOwned(userId);
  }

  async createEmailVerificationToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.accountRecovery.createEmailVerificationToken(input);
  }

  async consumeEmailVerificationToken(
    tokenHash: string,
    now: Date,
  ): Promise<string | null> {
    return this.accountRecovery.consumeEmailVerificationToken(tokenHash, now);
  }

  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.accountRecovery.createPasswordResetToken(input);
  }

  async consumePasswordResetToken(
    tokenHash: string,
    now: Date,
  ): Promise<string | null> {
    return this.accountRecovery.consumePasswordResetToken(tokenHash, now);
  }

  async listBrowserSessions(userId: string): Promise<BrowserSessionRecord[]> {
    return this.sessions.listActive(userId);
  }

  async listHouseholdAccess(
    userId: string,
    now: Date,
  ): Promise<HouseholdAccessRecord[]> {
    return this.sessions.listHouseholds(userId, now);
  }

  async switchSessionHousehold(
    userId: string,
    sessionId: string,
    householdId: string,
    now: Date,
  ): Promise<boolean> {
    return this.sessions.switchHousehold(userId, sessionId, householdId, now);
  }

  async listHouseholdMembers(
    householdId: string,
  ): Promise<HouseholdMemberRecord[]> {
    return this.sharing.listMembers(householdId);
  }

  async listHouseholdInvitations(
    householdId: string,
    now: Date,
  ): Promise<HouseholdInvitationRecord[]> {
    return this.sharing.listInvitations(householdId, now);
  }

  async createHouseholdInvitation(input: {
    householdId: string;
    invitedEmail: string;
    role: Exclude<SessionRecord['role'], 'owner'>;
    tokenHash: string;
    invitedByUserId: string;
    expiresAt: Date;
  }): Promise<string> {
    return this.sharing.createInvitation(input);
  }

  async acceptHouseholdInvitation(input: {
    tokenHash: string;
    userId: string;
    email: string;
    now: Date;
  }): Promise<{
    householdId: string;
    role: Exclude<SessionRecord['role'], 'owner'>;
  } | null> {
    return this.sharing.acceptInvitation(input);
  }

  async revokeHouseholdInvitation(
    householdId: string,
    invitationId: string,
  ): Promise<Exclude<SessionRecord['role'], 'owner'> | null> {
    return this.sharing.revokeInvitation(householdId, invitationId);
  }

  async replaceHouseholdMemberGrants(input: {
    householdId: string;
    memberId: string;
    grants: Array<{ cameraId: string; canListen: boolean; canTalk: boolean }>;
  }): Promise<string[] | null> {
    return this.sharing.replaceGrants(input);
  }

  async revokeHouseholdMember(
    householdId: string,
    memberId: string,
  ): Promise<string[] | null> {
    return this.sharing.revokeMember(householdId, memberId);
  }

  async revokeBrowserSession(
    userId: string,
    sessionId: string,
  ): Promise<boolean> {
    return this.sessions.revokeOwned(userId, sessionId);
  }

  async deleteAccount(userId: string): Promise<boolean> {
    return this.accounts.delete(userId);
  }

  async audit(input: AuditInput): Promise<void> {
    await this.auditRepository.audit(input);
  }

  async purgeExpiredAuditEvents(now: Date): Promise<number> {
    return this.auditRepository.purgeExpired(now);
  }

  async listAccessHistory(householdId: string): Promise<AccessHistoryRecord[]> {
    return this.auditRepository.listAccessHistory(householdId);
  }

  async listMotionEvents(
    householdId: string,
    options: MotionEventOptions = {},
  ): Promise<MotionEventRecord[]> {
    return this.motion.listMotionEvents(householdId, options);
  }

  async getMotionRetention(
    householdId: string,
  ): Promise<MotionRetentionRecord | null> {
    return this.motion.getMotionRetention(householdId);
  }

  async updateMotionRetention(
    householdId: string,
    days: MotionRetentionDays,
  ): Promise<MotionRetentionRecord | null> {
    return this.motion.updateMotionRetention(householdId, days);
  }

  async purgeExpiredMotionEvents(now: Date): Promise<RetentionPurgeRecord[]> {
    return this.motion.purgeExpiredMotionEvents(now);
  }

  async clearMotionEvents(householdId: string): Promise<number> {
    return this.motion.clearMotionEvents(householdId);
  }

  async listMotionSettings(
    householdId: string,
    publicDeviceId: string,
  ): Promise<CameraMotionSettings[]> {
    return this.motion.listMotionSettings(householdId, publicDeviceId);
  }

  async updateMotionSettings(
    householdId: string,
    publicCameraId: string,
    settings: MotionSettings,
  ): Promise<CameraMotionSettings | null> {
    return this.motion.updateMotionSettings(
      householdId,
      publicCameraId,
      settings,
    );
  }

  async createMotionEvent(input: {
    credentialHash: string;
    publicCameraId: string;
    confidence: number;
    now: Date;
  }): Promise<{ created: boolean; householdId: string } | null> {
    return this.motion.createMotionEvent(input);
  }

  async createPairingCode(
    householdId: string,
    codeHash: string,
    expiresAt: Date,
    targetDeviceId?: string,
  ): Promise<string> {
    return this.pairing.createCode(
      householdId,
      codeHash,
      expiresAt,
      targetDeviceId,
    );
  }

  async revokePairingCode(
    householdId: string,
    pairingCodeId: string,
  ): Promise<boolean> {
    return this.pairing.revokeCode(householdId, pairingCodeId);
  }

  async redeemPairingCode(input: {
    codeHash: string;
    credentialHash: string;
    installationId: string;
    name: string;
    ipAddress: string;
    now: Date;
  }): Promise<PairingRedemptionResult> {
    return this.pairing.redeem(input);
  }

  async listCameras(householdId: string): Promise<CameraRecord[]> {
    return this.devices.listCameras(householdId);
  }

  async listDevices(householdId: string): Promise<DeviceRecord[]> {
    return this.devices.listDevices(householdId);
  }

  async listAccessibleCameras(
    householdId: string,
    userId: string,
    role: SessionRecord['role'],
  ): Promise<CameraRecord[]> {
    return this.devices.listAccessibleCameras(householdId, userId, role);
  }

  async listAccessibleDevices(
    householdId: string,
    userId: string,
    role: SessionRecord['role'],
  ): Promise<DeviceRecord[]> {
    return this.devices.listAccessibleDevices(householdId, userId, role);
  }

  async syncDeviceCameras(
    credentialHash: string,
    sources: CameraSourceInput[],
    now: Date,
  ): Promise<CameraRecord[] | null> {
    return this.devices.syncCameras(credentialHash, sources, now);
  }

  async registerBrowserDevice(input: {
    householdId: string;
    installationId: string;
    name: string;
    sources: CameraSourceInput[];
    now: Date;
  }): Promise<{ device: DeviceRecord; cameras: CameraRecord[] }> {
    return this.devices.registerBrowser(input);
  }

  async heartbeat(
    credentialHash: string,
    now: Date,
    health?: { batteryPercent: number; batteryCharging: boolean },
  ): Promise<string | null> {
    return this.devices.heartbeat(credentialHash, now, health);
  }

  async updateDevice(
    householdId: string,
    publicDeviceId: string,
    changes: { enabled?: boolean | undefined; name?: string | undefined },
  ): Promise<boolean> {
    return this.devices.updateDevice(householdId, publicDeviceId, changes);
  }

  async updateCamera(
    householdId: string,
    publicCameraId: string,
    changes: {
      enabled?: boolean | undefined;
      name?: string | undefined;
    },
  ): Promise<boolean> {
    return this.devices.updateCamera(householdId, publicCameraId, changes);
  }

  async setPrivacyMode(
    householdId: string,
    publicDeviceId: string,
    enabled: boolean,
  ): Promise<string | null> {
    return this.devices.setPrivacyMode(householdId, publicDeviceId, enabled);
  }

  async revokeDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null> {
    return this.devices.revokeDevice(householdId, publicDeviceId);
  }

  async deleteDevice(
    householdId: string,
    publicDeviceId: string,
  ): Promise<string | null> {
    return this.devices.deleteDevice(householdId, publicDeviceId);
  }

  async deleteCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<boolean> {
    return this.devices.deleteCamera(householdId, publicCameraId);
  }

  async findDeviceByCredential(
    credentialHash: string,
  ): Promise<CameraIdentity | null> {
    return this.devices.findByCredential(credentialHash);
  }

  async findCameraForDeviceCredential(
    credentialHash: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    return this.devices.findCameraForCredential(credentialHash, publicCameraId);
  }

  async findOwnedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    return this.devices.findOwnedCamera(householdId, publicCameraId);
  }

  async findAccessibleCamera(
    householdId: string,
    userId: string,
    role: SessionRecord['role'],
    publicCameraId: string,
  ): Promise<CameraAccess | null> {
    return this.devices.findAccessibleCamera(
      householdId,
      userId,
      role,
      publicCameraId,
    );
  }

  async findManagedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    return this.devices.findManagedCamera(householdId, publicCameraId);
  }
}
