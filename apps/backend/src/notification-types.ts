export type NotificationChannel = 'fcm' | 'web_push';
export type NotificationCategory = 'motion' | 'offline' | 'recovered';

export interface NotificationPreferenceRecord {
  deviceId: string;
  deviceName: string;
  motionEnabled: boolean;
  offlineEnabled: boolean;
  quietHours: { start: string; end: string; timeZone: string } | null;
}

export interface NotificationDelivery {
  id: string;
  subscriptionId: string;
  channel: NotificationChannel;
  providerMaterial: string;
  safePayload: Record<string, string>;
  attemptCount: number;
}

export interface NotificationDeliveryOutcome {
  permanent: boolean;
  retryAfterMs?: number;
  success: boolean;
}

export interface NotificationSubscriptionInput {
  userId: string;
  sessionId: string;
  installationId: string;
  channel: NotificationChannel;
  providerMaterial: string;
  deviceLabel: string;
  consentedAt: Date;
}
