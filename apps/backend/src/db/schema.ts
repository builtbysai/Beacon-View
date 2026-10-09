import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
};

const bytea = customType<{ data: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    googleSubject: text('google_subject'),
    avatarUrl: text('avatar_url'),
    emailVerifiedAt: timestamp('email_verified_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_google_subject_unique').on(table.googleSubject),
  ],
);

export const emailVerificationTokens = pgTable(
  'email_verification_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('email_verification_tokens_token_hash_unique').on(
      table.tokenHash,
    ),
    index('email_verification_tokens_user_pending_idx')
      .on(table.userId, table.expiresAt)
      .where(sql`${table.consumedAt} is null`),
  ],
);

export const passwordResetTokens = pgTable(
  'password_reset_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('password_reset_tokens_token_hash_unique').on(table.tokenHash),
    index('password_reset_tokens_user_pending_idx')
      .on(table.userId, table.expiresAt)
      .where(sql`${table.consumedAt} is null`),
  ],
);

export const googleDriveConnections = pgTable('google_drive_connections', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  refreshTokenCiphertext: bytea('refresh_token_ciphertext').notNull(),
  refreshTokenIv: bytea('refresh_token_iv').notNull(),
  providerEmail: text('provider_email'),
  scopes: text('scopes').notNull(),
  /** Google stopped accepting the refresh token (ADR 0086). */
  expiredAt: timestamp('expired_at', { withTimezone: true }),
  ...timestamps,
});

export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    motionRetentionDays: integer('motion_retention_days').notNull().default(30),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('households_owner_unique').on(table.ownerId),
    check(
      'households_motion_retention_valid',
      sql`${table.motionRetentionDays} in (1, 7, 30, 90)`,
    ),
  ],
);

export const householdMembers = pgTable(
  'household_members',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    status: text('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    joinedAt: timestamp('joined_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('household_members_household_user_unique').on(
      table.householdId,
      table.userId,
    ),
    uniqueIndex('household_members_id_household_unique').on(
      table.id,
      table.householdId,
    ),
    index('household_members_user_active_idx')
      .on(table.userId, table.householdId)
      .where(sql`${table.status} = 'active'`),
    check(
      'household_members_role_valid',
      sql`${table.role} in ('owner', 'admin', 'viewer', 'guest')`,
    ),
    check(
      'household_members_status_valid',
      sql`${table.status} in ('active', 'revoked')`,
    ),
    check(
      'household_members_revocation_consistent',
      sql`(${table.status} = 'revoked') = (${table.revokedAt} is not null)`,
    ),
    check(
      'household_members_guest_expiry_required',
      sql`${table.role} <> 'guest' or ${table.expiresAt} is not null`,
    ),
  ],
);

export const householdInvitations = pgTable(
  'household_invitations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    invitedEmail: text('invited_email').notNull(),
    role: text('role').notNull(),
    tokenHash: text('token_hash').notNull(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    acceptedAt: timestamp('accepted_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    // The camera permissions a 'viewer' invite is accepted with, chosen by
    // whoever created it -- applied to the default grant every current
    // camera gets at acceptance (see acceptInvitation). Meaningless for
    // 'admin' (grants don't apply to them) and currently unused for
    // 'guest' (still opt-in per camera afterward, same as before).
    defaultCanListen: boolean('default_can_listen').notNull().default(false),
    defaultCanTalk: boolean('default_can_talk').notNull().default(false),
    defaultCanFlip: boolean('default_can_flip').notNull().default(false),
    defaultCanPause: boolean('default_can_pause').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('household_invitations_token_hash_unique').on(table.tokenHash),
    index('household_invitations_household_idx').on(
      table.householdId,
      table.createdAt,
    ),
    index('household_invitations_email_pending_idx')
      .on(table.invitedEmail, table.expiresAt)
      .where(sql`${table.acceptedAt} is null and ${table.revokedAt} is null`),
    check(
      'household_invitations_role_valid',
      sql`${table.role} in ('admin', 'viewer', 'guest')`,
    ),
    check(
      'household_invitations_email_normalized',
      sql`${table.invitedEmail} = lower(btrim(${table.invitedEmail}))`,
    ),
    check(
      'household_invitations_terminal_state_valid',
      sql`${table.acceptedAt} is null or ${table.revokedAt} is null`,
    ),
  ],
);

export const browserSessions = pgTable(
  'browser_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfHash: text('csrf_hash').notNull(),
    userAgent: text('user_agent'),
    idleExpiresAt: timestamp('idle_expires_at', {
      withTimezone: true,
    }).notNull(),
    absoluteExpiresAt: timestamp('absolute_expires_at', {
      withTimezone: true,
    }).notNull(),
    reauthenticatedAt: timestamp('reauthenticated_at', {
      withTimezone: true,
    })
      .notNull()
      .defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('browser_sessions_token_hash_unique').on(table.tokenHash),
    index('browser_sessions_user_idx').on(table.userId),
    index('browser_sessions_household_idx')
      .on(table.householdId, table.userId)
      .where(sql`${table.revokedAt} is null`),
  ],
);

export const cameras = pgTable(
  'cameras',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    publicDeviceId: uuid('public_device_id').notNull().defaultRandom(),
    installationId: uuid('installation_id').notNull(),
    name: text('name').notNull(),
    platform: text('platform').notNull().default('android'),
    deviceType: text('device_type').notNull().default('phone'),
    capabilities: jsonb('capabilities').notNull().default({}),
    softwareVersion: text('software_version'),
    enabled: boolean('enabled').notNull().default(true),
    privacyMode: boolean('privacy_mode').notNull().default(false),
    batteryPercent: integer('battery_percent'),
    batteryCharging: boolean('battery_charging'),
    healthReportedAt: timestamp('health_reported_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    // Whoever created the pairing code this device redeemed (or registered
    // the browser camera directly). Null for devices paired before this
    // column existed, and for a pairer whose account was later deleted --
    // either way, that just means only an owner/admin can remove it, same
    // as before this existed.
    pairedByUserId: uuid('paired_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('cameras_public_device_id_unique').on(table.publicDeviceId),
    uniqueIndex('cameras_installation_id_unique').on(table.installationId),
    index('cameras_household_idx').on(table.householdId),
    check(
      'cameras_platform_supported',
      sql`${table.platform} in ('android', 'browser')`,
    ),
    check(
      'cameras_battery_percent_valid',
      sql`${table.batteryPercent} between 0 and 100`,
    ),
  ],
);

// The physical-device table retains its historical SQL name (`cameras`) so
// existing credentials and pairings migrate without rewriting device IDs.
export const devices = cameras;

export const cameraSources = pgTable(
  'camera_sources',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    publicCameraId: uuid('public_camera_id').notNull().defaultRandom(),
    displayName: text('display_name').notNull(),
    sourceKey: text('source_key').notNull(),
    motionEnabled: boolean('motion_enabled').notNull().default(true),
    // Auto-starts a short recording when this source reports motion --
    // subject to the same enabled/sensitivity/cooldown/quiet-hours gating
    // that already decides whether the motion event itself is created, so
    // it never fires more often than motion detection already does.
    motionRecordEnabled: boolean('motion_record_enabled')
      .notNull()
      .default(false),
    // Cells of a 16 x 16 grid over the upright picture where movement is
    // ignored (ADR 0092). Cell numbers only, never an image.
    motionIgnoredZones: jsonb('motion_ignored_zones')
      .$type<number[]>()
      .notNull()
      .default([]),
    motionSensitivity: text('motion_sensitivity').notNull().default('medium'),
    motionCooldownSeconds: integer('motion_cooldown_seconds')
      .notNull()
      .default(30),
    motionQuietHoursStartMinute: integer('motion_quiet_hours_start_minute'),
    motionQuietHoursEndMinute: integer('motion_quiet_hours_end_minute'),
    motionQuietHoursTimeZone: text('motion_quiet_hours_time_zone'),
    facing: text('facing').notNull().default('unknown'),
    useCase: text('use_case').notNull().default('general'),
    capabilities: jsonb('capabilities').notNull().default({}),
    enabled: boolean('enabled').notNull().default(true),
    removedAt: timestamp('removed_at', { withTimezone: true }),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('camera_sources_public_id_unique').on(table.publicCameraId),
    uniqueIndex('camera_sources_device_source_unique').on(
      table.deviceId,
      table.sourceKey,
    ),
    index('camera_sources_device_idx').on(table.deviceId),
    check(
      'camera_sources_use_case_valid',
      sql`${table.useCase} in ('general', 'security', 'baby', 'doorbell')`,
    ),
    check(
      'camera_motion_sensitivity_valid',
      sql`${table.motionSensitivity} in ('low', 'medium', 'high')`,
    ),
    check(
      'camera_motion_cooldown_valid',
      sql`${table.motionCooldownSeconds} in (30, 60, 120, 300)`,
    ),
    check(
      'camera_motion_quiet_hours_complete',
      sql`(${table.motionQuietHoursStartMinute} is null) = (${table.motionQuietHoursEndMinute} is null) and (${table.motionQuietHoursStartMinute} is null) = (${table.motionQuietHoursTimeZone} is null)`,
    ),
    check(
      'camera_motion_quiet_hours_minutes_valid',
      sql`(${table.motionQuietHoursStartMinute} is null or ${table.motionQuietHoursStartMinute} between 0 and 1439) and (${table.motionQuietHoursEndMinute} is null or ${table.motionQuietHoursEndMinute} between 0 and 1439) and (${table.motionQuietHoursStartMinute} is null or ${table.motionQuietHoursStartMinute} <> ${table.motionQuietHoursEndMinute})`,
    ),
    check(
      'camera_sources_facing_supported',
      sql`${table.facing} in ('front', 'rear', 'external', 'unknown')`,
    ),
  ],
);

export const recordings = pgTable(
  'recordings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    cameraSourceId: uuid('camera_source_id')
      .notNull()
      .references(() => cameraSources.id, { onDelete: 'cascade' }),
    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    // Null for a manually started recording. Set for an automatic,
    // motion-triggered one, so a clip can be shown as supporting evidence on
    // the Activity event that caused it rather than as its own timeline row.
    triggerMotionEventId: uuid('trigger_motion_event_id').references(
      () => motionEvents.id,
      { onDelete: 'set null' },
    ),
    status: text('status').notNull().default('requested'),
    provider: text('provider').notNull().default('google_drive'),
    providerFileId: text('provider_file_id'),
    durationMs: integer('duration_ms'),
    byteSize: integer('byte_size'),
    checksumSha256: text('checksum_sha256'),
    mimeType: text('mime_type'),
    encryptionVersion: integer('encryption_version'),
    encryptionIv: bytea('encryption_iv'),
    encryptionDataKeyCiphertext: bytea('encryption_data_key_ciphertext'),
    encryptionDataKeyIv: bytea('encryption_data_key_iv'),
    // A thumbnail is a second, independently encrypted small image captured
    // client-side (never derived from decrypting the clip server-side) --
    // same envelope shape as the clip itself. Null until (and unless) one is
    // uploaded; a clip is fully usable without one. See ADR 0078.
    thumbnailProviderFileId: text('thumbnail_provider_file_id'),
    thumbnailByteSize: integer('thumbnail_byte_size'),
    thumbnailChecksumSha256: text('thumbnail_checksum_sha256'),
    thumbnailMimeType: text('thumbnail_mime_type'),
    thumbnailEncryptionIv: bytea('thumbnail_encryption_iv'),
    thumbnailEncryptionDataKeyCiphertext: bytea(
      'thumbnail_encryption_data_key_ciphertext',
    ),
    thumbnailEncryptionDataKeyIv: bytea('thumbnail_encryption_data_key_iv'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    index('recordings_household_created_idx').on(
      table.householdId,
      table.createdAt,
    ),
    index('recordings_camera_created_idx').on(
      table.cameraSourceId,
      table.createdAt,
    ),
    index('recordings_trigger_motion_event_idx').on(table.triggerMotionEventId),
    uniqueIndex('recordings_provider_file_unique').on(table.providerFileId),
    uniqueIndex('recordings_thumbnail_provider_file_unique').on(
      table.thumbnailProviderFileId,
    ),
    check(
      'recordings_status_valid',
      sql`${table.status} in ('requested', 'recording', 'uploading', 'available', 'failed', 'deleting', 'deleted')`,
    ),
    check(
      'recordings_provider_valid',
      sql`${table.provider} in ('google_drive')`,
    ),
    check(
      'recordings_duration_valid',
      sql`${table.durationMs} is null or ${table.durationMs} > 0`,
    ),
    check(
      'recordings_size_valid',
      sql`${table.byteSize} is null or ${table.byteSize} > 0`,
    ),
    check(
      'recordings_mime_type_valid',
      sql`${table.mimeType} is null or ${table.mimeType} in ('video/mp4', 'video/webm')`,
    ),
    check(
      'recordings_thumbnail_size_valid',
      sql`${table.thumbnailByteSize} is null or ${table.thumbnailByteSize} > 0`,
    ),
    check(
      'recordings_thumbnail_mime_type_valid',
      sql`${table.thumbnailMimeType} is null or ${table.thumbnailMimeType} in ('image/jpeg', 'image/webp')`,
    ),
  ],
);

export const cameraGrants = pgTable(
  'camera_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    memberId: uuid('member_id').notNull(),
    cameraSourceId: uuid('camera_source_id')
      .notNull()
      .references(() => cameraSources.id, { onDelete: 'cascade' }),
    canListen: boolean('can_listen').notNull().default(false),
    canTalk: boolean('can_talk').notNull().default(false),
    // View (this row existing) is the only permission every grant implies.
    // Everything else is opt-in per camera.
    canFlip: boolean('can_flip').notNull().default(false),
    canPause: boolean('can_pause').notNull().default(false),
    ...timestamps,
  },
  (table) => [
    foreignKey({
      columns: [table.memberId, table.householdId],
      foreignColumns: [householdMembers.id, householdMembers.householdId],
      name: 'camera_grants_member_household_fk',
    }).onDelete('cascade'),
    uniqueIndex('camera_grants_member_camera_unique').on(
      table.memberId,
      table.cameraSourceId,
    ),
    index('camera_grants_household_idx').on(table.householdId),
  ],
);

export const deviceCredentials = pgTable(
  'device_credentials',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cameraId: uuid('camera_id')
      .notNull()
      .references(() => cameras.id, { onDelete: 'cascade' }),
    credentialHash: text('credential_hash').notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('device_credentials_camera_unique').on(table.cameraId),
    uniqueIndex('device_credentials_hash_unique').on(table.credentialHash),
  ],
);

export const pairingCodes = pgTable(
  'pairing_codes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    cameraId: uuid('camera_id').references(() => cameras.id, {
      onDelete: 'set null',
    }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('pairing_codes_hash_unique').on(table.codeHash),
    index('pairing_codes_household_idx').on(table.householdId),
    check(
      'pairing_codes_single_terminal_state',
      sql`not (${table.consumedAt} is not null and ${table.revokedAt} is not null)`,
    ),
  ],
);

export const auditEvents = pgTable(
  'audit_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    householdId: uuid('household_id').references(() => households.id, {
      onDelete: 'set null',
    }),
    cameraId: uuid('camera_id').references(() => cameras.id, {
      onDelete: 'set null',
    }),
    eventType: text('event_type').notNull(),
    success: boolean('success').notNull(),
    ipAddress: text('ip_address'),
    metadata: jsonb('metadata').notNull().default({}),
    // Client-generated per-viewing-attempt id, sent once when a Live Viewer
    // session opens and reused across its own automatic reconnects, so
    // access-history can group "one continuous attempt, N tries" without
    // guessing from timestamp proximity. Null for non-viewer event types
    // and for rows written before this column existed.
    viewerSessionId: uuid('viewer_session_id'),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('audit_events_occurred_idx').on(table.occurredAt),
    index('audit_events_viewer_session_idx').on(table.viewerSessionId),
  ],
);

export const motionEvents = pgTable(
  'motion_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cameraSourceId: uuid('camera_source_id')
      .notNull()
      .references(() => cameraSources.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull().default('motion'),
    confidence: real('confidence').notNull(),
    metadata: jsonb('metadata').notNull().default({}),
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index('motion_events_camera_occurred_idx').on(
      table.cameraSourceId,
      table.occurredAt,
    ),
  ],
);

export const notificationSubscriptions = pgTable(
  'notification_subscriptions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => browserSessions.id, { onDelete: 'cascade' }),
    installationId: uuid('installation_id').notNull(),
    channel: text('channel').notNull(),
    providerCiphertext: bytea('provider_ciphertext').notNull(),
    providerIv: bytea('provider_iv').notNull(),
    wrappedKey: bytea('wrapped_key').notNull(),
    wrappedKeyIv: bytea('wrapped_key_iv').notNull(),
    providerFingerprint: text('provider_fingerprint').notNull(),
    keyVersion: integer('key_version').notNull(),
    deviceLabel: text('device_label').notNull(),
    consentedAt: timestamp('consented_at', { withTimezone: true }).notNull(),
    lastRegisteredAt: timestamp('last_registered_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    lastSuccessAt: timestamp('last_success_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('notification_subscriptions_active_installation_unique')
      .on(table.userId, table.installationId, table.channel)
      .where(sql`${table.revokedAt} is null`),
    uniqueIndex('notification_subscriptions_active_provider_unique')
      .on(table.providerFingerprint)
      .where(sql`${table.revokedAt} is null`),
    index('notification_subscriptions_session_idx')
      .on(table.sessionId)
      .where(sql`${table.revokedAt} is null`),
    check(
      'notification_subscriptions_channel_valid',
      sql`${table.channel} in ('fcm', 'web_push', 'desktop')`,
    ),
    check(
      'notification_subscriptions_label_length',
      sql`char_length(${table.deviceLabel}) between 1 and 80`,
    ),
  ],
);

export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id')
      .notNull()
      .references(() => devices.id, { onDelete: 'cascade' }),
    motionEnabled: boolean('motion_enabled').notNull().default(false),
    offlineEnabled: boolean('offline_enabled').notNull().default(false),
    quietStartMinute: integer('quiet_start_minute'),
    quietEndMinute: integer('quiet_end_minute'),
    quietTimeZone: text('quiet_time_zone'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('notification_preferences_user_device_unique').on(
      table.userId,
      table.deviceId,
    ),
    check(
      'notification_preferences_quiet_complete',
      sql`(${table.quietStartMinute} is null) = (${table.quietEndMinute} is null) and (${table.quietStartMinute} is null) = (${table.quietTimeZone} is null)`,
    ),
    check(
      'notification_preferences_quiet_valid',
      sql`(${table.quietStartMinute} is null or ${table.quietStartMinute} between 0 and 1439) and (${table.quietEndMinute} is null or ${table.quietEndMinute} between 0 and 1439) and (${table.quietStartMinute} is null or ${table.quietStartMinute} <> ${table.quietEndMinute})`,
    ),
  ],
);

export const notificationEvents = pgTable(
  'notification_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, {
      onDelete: 'cascade',
    }),
    cameraSourceId: uuid('camera_source_id').references(
      () => cameraSources.id,
      { onDelete: 'cascade' },
    ),
    category: text('category').notNull(),
    deduplicationKey: text('deduplication_key').notNull(),
    safePayload: jsonb('safe_payload').notNull(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_events_user_deduplication_unique').on(
      table.userId,
      table.deduplicationKey,
    ),
    check(
      'notification_events_category_valid',
      sql`${table.category} in ('motion', 'offline', 'recovered', 'security')`,
    ),
  ],
);

export const notificationOutbox = pgTable(
  'notification_outbox',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    eventId: uuid('event_id')
      .notNull()
      .references(() => notificationEvents.id, { onDelete: 'cascade' }),
    subscriptionId: uuid('subscription_id')
      .notNull()
      .references(() => notificationSubscriptions.id, { onDelete: 'cascade' }),
    safePayload: jsonb('safe_payload').notNull(),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
    claimedUntil: timestamp('claimed_until', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    terminalAt: timestamp('terminal_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex('notification_outbox_event_subscription_unique').on(
      table.eventId,
      table.subscriptionId,
    ),
    index('notification_outbox_pending_idx')
      .on(table.nextAttemptAt, table.id)
      .where(sql`${table.deliveredAt} is null and ${table.terminalAt} is null`),
    check(
      'notification_outbox_attempt_count_valid',
      sql`${table.attemptCount} between 0 and 5`,
    ),
  ],
);

export const notificationPresenceState = pgTable(
  'notification_presence_state',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    deviceId: uuid('device_id').references(() => devices.id, {
      onDelete: 'cascade',
    }),
    candidateSince: timestamp('candidate_since', { withTimezone: true }),
    offlineEventId: uuid('offline_event_id').references(
      () => notificationEvents.id,
      { onDelete: 'set null' },
    ),
    offlineSince: timestamp('offline_since', { withTimezone: true }),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.deviceId] })],
);

// A guest link is the third, distinct kind of household access alongside
// signed-in viewer/guest roles: no account, no household_members row at
// all. Anyone holding the (long, random) link token gets read access to
// exactly the cameras and controls chosen when it was created, until it
// expires or an admin revokes it -- see guest-routes.ts.
export const guestLinks = pgTable(
  'guest_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    label: text('label'),
    canListen: boolean('can_listen').notNull().default(false),
    canTalk: boolean('can_talk').notNull().default(false),
    canFlip: boolean('can_flip').notNull().default(false),
    canPause: boolean('can_pause').notNull().default(false),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('guest_links_token_hash_unique').on(table.tokenHash),
    index('guest_links_household_idx').on(table.householdId),
  ],
);

export const guestLinkCameras = pgTable(
  'guest_link_cameras',
  {
    guestLinkId: uuid('guest_link_id')
      .notNull()
      .references(() => guestLinks.id, { onDelete: 'cascade' }),
    cameraSourceId: uuid('camera_source_id')
      .notNull()
      .references(() => cameraSources.id, { onDelete: 'cascade' }),
  },
  (table) => [
    primaryKey({ columns: [table.guestLinkId, table.cameraSourceId] }),
  ],
);

// A household owner's time-limited, revocable link letting someone outside
// the household view one specific clip without a Beacon account. At most one
// active (non-expired, non-revoked) link exists per recording -- creating a
// new one revokes the old one first. See ADR 0077.
export const recordingShareLinks = pgTable(
  'recording_share_links',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    recordingId: uuid('recording_id')
      .notNull()
      .references(() => recordings.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    lastAccessedAt: timestamp('last_accessed_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('recording_share_links_token_hash_unique').on(table.tokenHash),
    index('recording_share_links_recording_idx').on(table.recordingId),
  ],
);
