export type HouseholdRole = 'owner' | 'admin' | 'viewer' | 'guest';

export interface HouseholdMembership {
  role: HouseholdRole;
  status: 'active' | 'revoked';
  expiresAt: Date | null;
}

interface CameraGrant {
  canListen: boolean;
  canTalk: boolean;
}

type HouseholdCapability =
  'manage_cameras' | 'manage_members' | 'view_camera' | 'listen' | 'talk';

/** Central deny-by-default policy for household sharing. Routes and sockets
 * consume this policy rather than growing their own role checks. */
export function hasHouseholdCapability(
  membership: HouseholdMembership | null,
  capability: HouseholdCapability,
  grant: CameraGrant | null,
  now = new Date(),
): boolean {
  if (
    !membership ||
    membership.status !== 'active' ||
    (membership.expiresAt !== null && membership.expiresAt <= now)
  ) {
    return false;
  }

  if (membership.role === 'owner' || membership.role === 'admin') return true;
  if (capability === 'manage_cameras' || capability === 'manage_members') {
    return false;
  }
  if (!grant) return false;
  if (capability === 'listen') return grant.canListen;
  if (capability === 'talk') return grant.canTalk;
  return capability === 'view_camera';
}

export function canAssignRole(
  actor: HouseholdMembership | null,
  targetRole: HouseholdRole,
  now = new Date(),
): boolean {
  if (!hasHouseholdCapability(actor, 'manage_members', null, now)) return false;
  if (targetRole === 'owner') return false;
  return (
    actor?.role === 'owner' || targetRole === 'viewer' || targetRole === 'guest'
  );
}
