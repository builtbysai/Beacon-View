import { describe, expect, it } from 'vitest';
import { cameraStatus } from './camera-status';

const camera = {
  online: true,
  enabled: true,
  credentialRevoked: false,
  streaming: true,
};

describe('camera availability presented to viewers', () => {
  it('prioritizes authorization, disablement, privacy and connectivity over stale live status', () => {
    expect(cameraStatus({ ...camera, credentialRevoked: true }).label).toBe(
      'Pair again',
    );
    expect(cameraStatus({ ...camera, enabled: false }).available).toBe(false);
    expect(cameraStatus({ ...camera, privacyMode: true }).label).toBe(
      'Privacy on',
    );
    expect(
      cameraStatus({ ...camera, privacyMode: true, online: false }).available,
    ).toBe(false);
    expect(cameraStatus({ ...camera, online: false }).label).toBe('Offline');
    expect(cameraStatus(camera)).toMatchObject({
      available: true,
      label: 'Live',
    });
    expect(cameraStatus({ ...camera, streaming: false }).label).toBe('Ready');
  });
});
