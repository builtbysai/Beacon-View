import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
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
    passwordHash: text('password_hash').notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex('users_email_unique').on(table.email)],
);

export const households = pgTable(
  'households',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    ownerId: uuid('owner_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    ...timestamps,
  },
  (table) => [uniqueIndex('households_owner_unique').on(table.ownerId)],
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
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex('cameras_public_device_id_unique').on(table.publicDeviceId),
    uniqueIndex('cameras_installation_id_unique').on(table.installationId),
    index('cameras_household_idx').on(table.householdId),
    check('cameras_platform_android', sql`${table.platform} = 'android'`),
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
