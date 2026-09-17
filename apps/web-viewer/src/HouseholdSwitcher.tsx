import { useEffect, useState } from 'react';

import { request } from './api';
import type { HouseholdRole } from './domain';

interface HouseholdAccess {
  expiresAt: string | null;
  id: string;
  name: string;
  role: HouseholdRole;
}

function roleLabel(role: HouseholdRole): string {
  return role[0]!.toUpperCase() + role.slice(1);
}

/** One identity row: which household, who owns it (inferred from the
 * "owner" role in the same access list -- the backend doesn't expose a
 * separate ownerEmail field), and the viewer's own role. Switching only
 * renders when the account actually has more than one household to move
 * between. */
export function HouseholdSwitcher({
  currentHouseholdId,
  memberCount,
  cameraCount,
}: {
  currentHouseholdId: string;
  /** Real counts from data already loaded by the caller -- this component
   * doesn't fetch its own metrics just to fill a stat card. */
  memberCount: number | null;
  cameraCount: number;
}) {
  const [households, setHouseholds] = useState<HouseholdAccess[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    void request<{ households: HouseholdAccess[] }>('/api/account/households')
      .then((result) => {
        if (active) setHouseholds(result.households);
      })
      .catch((caught) => {
        if (active)
          setError(
            caught instanceof Error
              ? caught.message
              : 'Unable to load households',
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const current = households.find((item) => item.id === currentHouseholdId);

  return (
    <div className="household-identity">
      <div className="household-identity-main">
        <strong>{current?.name ?? 'Household'}</strong>
        <span>You are {current ? roleLabel(current.role) : '…'}</span>
      </div>
      {households.length > 1 && (
        <label className="household-switch">
          <span className="visually-hidden">Switch household</span>
          <select
            aria-label="Switch household"
            disabled={busy}
            value={currentHouseholdId}
            onChange={(event) => {
              const householdId = event.target.value;
              setBusy(true);
              setError('');
              void request('/api/account/household', {
                body: JSON.stringify({ householdId }),
                method: 'PUT',
              })
                .then(() => window.location.assign('/'))
                .catch((caught) => {
                  setBusy(false);
                  setError(
                    caught instanceof Error
                      ? caught.message
                      : 'Unable to switch households',
                  );
                });
            }}
          >
            {households.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name} · {item.role}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="household-identity-counts">
        {memberCount !== null
          ? `${memberCount} ${memberCount === 1 ? 'person' : 'people'} · `
          : ''}
        {cameraCount} {cameraCount === 1 ? 'camera' : 'cameras'}
      </p>
      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}
    </div>
  );
}
