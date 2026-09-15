export interface User {
  id: string;
  email: string;
  avatarUrl?: string | null;
  emailVerified?: boolean;
  googleLinked?: boolean;
  hasPassword?: boolean;
}

export type HouseholdRole = 'owner' | 'admin' | 'viewer' | 'guest';

export interface HouseholdSession {
  id: string;
  role: HouseholdRole;
}

export interface Camera {
  id: string;
  deviceId: string;
  deviceName: string;
  name: string;
  online: boolean;
  platform: 'android' | 'browser';
  facing: string;
  enabled: boolean;
  streaming: boolean;
  viewerCount: number;
  lastSeenAt: string | null;
  credentialRevoked: boolean;
  capabilities?: Record<string, boolean | number | string>;
  availability?: string;
  privacyMode?: boolean;
  sourceKey?: string;
  /** Owner/admin, or whoever personally paired this camera. */
  canRemove?: boolean;
  /** A viewer/guest can always drop their own access to a camera someone
   * else shared with them. */
  canLeave?: boolean;
}

export interface Device {
  id: string;
  name: string;
  platform: 'android' | 'browser';
  deviceType: string;
  online: boolean;
  lastSeenAt: string | null;
  revoked: boolean;
  enabled: boolean;
  privacyMode?: boolean;
  softwareVersion?: string | null;
  batteryPercent?: number | null;
  batteryCharging?: boolean | null;
  healthReportedAt?: string | null;
  capabilities?: Record<string, boolean | number | string>;
  canRemove?: boolean;
}
