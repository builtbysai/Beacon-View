import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
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

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull(),
    passwordHash: text('password_hash'),
    googleSubject: text('google_subject'),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('users_email_unique').on(table.email),
    uniqueIndex('users_google_subject_unique').on(table.googleSubject),
  ],
);

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

export const browserSessions = pgTable(
  'browser_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    csrfHash: text('csrf_hash').notNull(),
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
    motionSensitivity: text('motion_sensitivity').notNull().default('medium'),
    motionCooldownSeconds: integer('motion_cooldown_seconds')
      .notNull()
      .default(30),
    motionQuietHoursStartMinute: integer('motion_quiet_hours_start_minute'),
    motionQuietHoursEndMinute: integer('motion_quiet_hours_end_minute'),
    motionQuietHoursTimeZone: text('motion_quiet_hours_time_zone'),
    facing: text('facing').notNull().default('unknown'),
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
    occurredAt: timestamp('occurred_at', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index('audit_events_occurred_idx').on(table.occurredAt)],
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
