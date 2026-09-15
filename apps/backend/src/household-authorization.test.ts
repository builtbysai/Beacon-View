import { describe, expect, it } from 'vitest';

import {
  canAssignRole,
  hasHouseholdCapability,
  type HouseholdMembership,
} from './household-authorization.js';

const now = new Date('2026-09-12T12:00:00Z');

function member(
  role: HouseholdMembership['role'],
  expiresAt: Date | null = null,
): HouseholdMembership {
  return { expiresAt, role, status: 'active' };
}

describe('household authorization', () => {
  it('gives owners and admins household capabilities', () => {
    for (const role of ['owner', 'admin'] as const) {
      expect(
        hasHouseholdCapability(member(role), 'manage_cameras', null, now),
      ).toBe(true);
      expect(
        hasHouseholdCapability(member(role), 'view_camera', null, now),
      ).toBe(true);
    }
  });

  it('denies revoked and expired memberships before considering grants', () => {
    expect(
      hasHouseholdCapability(
        { ...member('viewer'), status: 'revoked' },
        'view_camera',
        { canListen: true, canTalk: true },
        now,
      ),
    ).toBe(false);
    expect(
      hasHouseholdCapability(
        member('guest', new Date('2026-09-12T11:59:59Z')),
        'view_camera',
        { canListen: true, canTalk: true },
        now,
      ),
    ).toBe(false);
  });

  it('requires an explicit camera grant for viewers and guests', () => {
    expect(
      hasHouseholdCapability(member('viewer'), 'view_camera', null, now),
    ).toBe(false);
    expect(
      hasHouseholdCapability(
        member('viewer'),
        'view_camera',
        { canListen: false, canTalk: false },
        now,
      ),
    ).toBe(true);
    expect(
      hasHouseholdCapability(
        member('guest', new Date('2026-09-13T12:00:00Z')),
        'listen',
        { canListen: false, canTalk: true },
        now,
      ),
    ).toBe(false);
    expect(
      hasHouseholdCapability(
        member('guest', new Date('2026-09-13T12:00:00Z')),
        'talk',
        { canListen: false, canTalk: true },
        now,
      ),
    ).toBe(true);
  });

  it('never lets an admin assign owner or admin authority', () => {
    expect(canAssignRole(member('owner'), 'admin', now)).toBe(true);
    expect(canAssignRole(member('owner'), 'owner', now)).toBe(false);
    expect(canAssignRole(member('admin'), 'admin', now)).toBe(false);
    expect(canAssignRole(member('admin'), 'viewer', now)).toBe(true);
    expect(canAssignRole(member('viewer'), 'guest', now)).toBe(false);
  });
});
