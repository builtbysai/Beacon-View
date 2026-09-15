import { z } from 'zod';

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
export const cameraSourceSchema = z.object({
  sourceKey: z.string().trim().min(1).max(200),
  name: z.string().trim().min(1).max(100),
  facing: z.enum(['front', 'rear', 'external', 'unknown']),
  capabilities: z
    .record(z.string(), z.union([z.boolean(), z.number(), z.string()]))
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
export const updateDeviceSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.name !== undefined);
export const updateCameraSchema = z
  .object({
    enabled: z.boolean().optional(),
    name: z.string().trim().min(1).max(100).optional(),
  })
  .refine((value) => value.enabled !== undefined || value.name !== undefined);
export const privacyModeSchema = z.object({ enabled: z.boolean() });
export const heartbeatSchema = z
  .object({
    batteryPercent: z.number().int().min(0).max(100).optional(),
    batteryCharging: z.boolean().optional(),
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
export const googleStartSchema = z.object({
  platform: z.literal('android').optional(),
  intent: z.literal('addPassword').optional(),
});
export const mobileGoogleExchangeSchema = z.object({
  code: z.string().min(32).max(512),
});
