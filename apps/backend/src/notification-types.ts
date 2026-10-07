export type NotificationChannel = 'fcm' | 'web_push' | 'desktop';
export type NotificationCategory =
  'motion' | 'offline' | 'recovered' | 'security';

/** Security events cannot be silenced by camera-level preferences the way
 * motion/offline/recovered can -- there is no per-device row to disable
 * them, unlike NotificationCategory's other members.
 *
 * Password changes and account deletion are deliberately NOT here: both
 * revoke every one of the user's sessions (and, with it, every push
 * subscription tied to those sessions -- see
 * PostgresSessionRepository.revoke/revokeAllOwned), so an outbox entry for
 * either would almost never have a live subscription left to deliver to.
 * Both get an email alert instead (account-recovery-email.ts), which
 * doesn't depend on a still-active session. */
export type SecurityEventType =
  | 'sign_in'
  | 'email_verified'
  | 'device_revoked'
  | 'household_membership_changed';

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
  /** The alert is no longer worth showing (the device was offline past the
   * alert's useful life). Ends this delivery without revoking anything. */
  expired?: boolean;
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
