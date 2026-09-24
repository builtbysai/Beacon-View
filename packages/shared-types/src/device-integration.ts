/** Design contract for future device adapters. It does not enable a protocol. */
export type DeviceCapability =
  'live-video' | 'listen' | 'talk' | 'motion-events' | 'telemetry' | 'control';

export type DeviceTransport = 'local-network' | 'vendor-cloud';

export interface DeviceIntegrationDefinition {
  /** Stable namespace used to distinguish this adapter from a device ID. */
  id: string;
  displayName: string;
  transport: DeviceTransport;
  capabilities: readonly DeviceCapability[];
  /** The user must begin enrollment and be able to revoke it later. */
  enrollment: 'user-initiated-revocable';
  /** A camera adapter must prove a visible capture indicator on the source. */
  captureIndicator: 'visible-on-source' | 'not-applicable';
  /** Media must remain on the authorized live path unless separately approved. */
  mediaHandling: 'live-only' | 'not-applicable';
}
