import { useEffect, useState } from 'react';

import { request } from './api';
import { SettingsCard, SettingsRow } from './SettingsUI';
import type { HouseholdRole } from './domain';

interface HouseholdAccess {
  expiresAt: string | null;
  id: string;
  name: string;
  role: HouseholdRole;
}

export function HouseholdSwitcher({
  currentHouseholdId,
}: {
  currentHouseholdId: string;
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
    <SettingsCard aria-label="Household">
      <SettingsRow
        title={current?.name ?? 'Current household'}
        description={
          <>
            {current
              ? `${current.role[0]!.toUpperCase()}${current.role.slice(1)} access${
                  current.expiresAt
                    ? ` until ${new Date(current.expiresAt).toLocaleString()}`
                    : ''
                }`
              : 'Loading household access…'}
            {error && <span role="alert">{` ${error}`}</span>}
          </>
        }
      >
        {households.length > 1 && (
          <label>
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
      </SettingsRow>
    </SettingsCard>
  );
}
