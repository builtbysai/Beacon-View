export interface HealthResponse {
  status: 'ok';
  service: 'backend';
  timestamp: string;
}

export type DevicePlatform = 'android' | 'browser';
export type ProducerConnectionState =
  'offline' | 'reconnecting' | 'online' | 'error';
export type CameraStreamingState = 'idle' | 'streaming';

export interface BeaconDevice {
  id: string;
  name: string;
  platform: DevicePlatform;
  online: boolean;
  lastSeenAt: string | null;
}

export interface BeaconCamera {
  id: string;
  deviceId: string;
  deviceName: string;
  name: string;
  facing: 'front' | 'rear' | 'external' | 'unknown';
  enabled: boolean;
  online: boolean;
  streaming: boolean;
  viewerCount: number;
}
