import { z } from 'zod';

import {
  PKCE_CHALLENGE_PATTERN,
  PKCE_VERIFIER_PATTERN,
} from './desktop-google-handoff.js';
import { MOTION_RETENTION_DAYS } from './store.js';

export const credentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email().max(320),
  password: z.string().min(12).max(128),
});
export const registerDeviceSchema = z.object({
  installationId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  pairingCode: z.string().trim().min(1).max(32),
});
const cameraSourceSchema = z.object({
  sourceKey: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  facing: z.enum(['front', 'rear', 'external', 'unknown']),
  // Bounded so a client cannot store an arbitrarily large blob (V56). Unknown
  // top-level fields stay accepted: older apps in the field send extras.
  capabilities: z
    .record(
      z.string().max(64),
      z.union([z.boolean(), z.number(), z.string().max(200)]),
    )
    .refine((value) => Object.keys(value).length <= 32)
    .optional(),
});
export const syncCameraSourcesSchema = z.object({
  sources: z.array(cameraSourceSchema).min(1).max(12),
});
export const browserDeviceSchema = z.object({
  installationId: z.string().uuid(),
  name: z.string().trim().min(1).max(100),
  sources: z.array(cameraSourceSchema).min(1).max(12),
});
export const cameraParameterSchema = z.object({ cameraId: z.string().uuid() });
export const deviceParameterSchema = z.object({ deviceId: z.string().uuid() });
export const motionEventParameterSchema = z.object({
  motionEventId: z.string().uuid(),
});
export const updateDeviceSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.name !== undefined);
export const updateCameraSchema = z
  .strictObject({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.name !== undefined);
export const privacyModeSchema = z.object({ enabled: z.boolean() });
/** Android's PowerManager thermal statuses (ADR 0093). */
export const THERMAL_STATUSES = [
  'none',
  'light',
  'moderate',
  'severe',
  'critical',
  'emergency',
  'shutdown',
] as const;
export type ThermalStatus = (typeof THERMAL_STATUSES)[number];

export const heartbeatSchema = z
  .object({
    batteryPercent: z.number().int().min(0).max(100).optional(),
    batteryCharging: z.boolean().optional(),
    thermalStatus: z.enum(THERMAL_STATUSES).optional(),
  })
  .strict()
  .refine(
    (value) =>
      (value.batteryPercent === undefined) ===
      (value.batteryCharging === undefined),
  );
export const motionEventSchema = z.object({
  confidence: z.number().finite().min(0).max(1),
});
export const motionRetentionSchema = z
  .object({ days: z.number().int() })
  .strict()
  .refine((value): value is { days: (typeof MOTION_RETENTION_DAYS)[number] } =>
    MOTION_RETENTION_DAYS.includes(
      value.days as (typeof MOTION_RETENTION_DAYS)[number],
    ),
  );
export const pairingCodeParameterSchema = z.object({
  pairingCodeId: z.string().uuid(),
});
export const sessionParameterSchema = z.object({
  sessionId: z.string().uuid(),
});
export const householdSelectionSchema = z.object({
  householdId: z.string().uuid(),
});
export const accountDeletionSchema = z.object({
  confirmation: z.literal('DELETE'),
});
export const contactSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    message: z.string().trim().min(1).max(3_000),
    name: z.string().trim().max(100).optional(),
    subject: z.string().trim().min(1).max(140),
    website: z.string().max(200).optional(),
  })
  .strict();
export const googleCallbackSchema = z.object({
  code: z.string().min(1).max(4_096),
  state: z.string().min(1).max(512),
});
export const googleStartSchema = z
  .object({
    platform: z.enum(['desktop']).optional(),
    intent: z.literal('addPassword').optional(),
    // PKCE S256 challenge; required for (and only accepted from) the desktop
    // and Android apps, whose return links other apps on the device can read.
    // (The Android app uses the desktop hand-off, ADR 0121.)
    challenge: z.string().regex(PKCE_CHALLENGE_PATTERN).optional(),
  })
  .refine(
    (start) =>
      (start.platform === 'desktop') === (start.challenge !== undefined),
  );
export const desktopGoogleExchangeSchema = z
  .object({
    code: z.string().min(32).max(512),
    verifier: z.string().regex(PKCE_VERIFIER_PATTERN),
  })
  .strict();
