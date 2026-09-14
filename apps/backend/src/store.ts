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
import {
  type AccessHistoryRecord,
  type AuditInput,
  type BrowserSessionRecord,
  type CameraIdentity,
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

  constructor(databaseUrl: string) {
    this.pool = new Pool({ connectionString: databaseUrl, max: 10 });
    this.auditRepository = new PostgresAuditRepository(this.pool);
    this.accounts = new PostgresAccountRepository(
      this.pool,
      this.auditRepository,
    );
    this.devices = new PostgresDeviceRepository(this.pool);
    this.motion = new PostgresMotionRepository(this.pool);
    this.pairing = new PostgresPairingRepository(
      this.pool,
      this.auditRepository,
    );
    this.sessions = new PostgresSessionRepository(this.pool);
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

  async listBrowserSessions(userId: string): Promise<BrowserSessionRecord[]> {
    return this.sessions.listActive(userId);
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
  ): Promise<string> {
    return this.pairing.createCode(householdId, codeHash, expiresAt);
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

  async findManagedCamera(
    householdId: string,
    publicCameraId: string,
  ): Promise<CameraIdentity | null> {
    return this.devices.findManagedCamera(householdId, publicCameraId);
  }
}
