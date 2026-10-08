import { useEffect, useState } from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';
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

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? '')
      .join('') || 'H'
  );
}

export function HouseholdSwitcher({
  currentHouseholdId,
  memberCount,
  cameraCount,
}: {
  currentHouseholdId: string;
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
            friendlyError(
              caught,
              'Your households couldn’t be loaded. Try again.',
            ),
          );
      });
    return () => {
      active = false;
    };
  }, []);

  const current = households.find((item) => item.id === currentHouseholdId);
  const name = current?.name ?? 'Household';
  const role = current ? roleLabel(current.role) : '…';
  const isOwner = current?.role === 'owner';

  return (
    <div className="household-card">
      <div className="household-card-hero">
        <div className="household-avatar" aria-hidden="true">
          {initials(name)}
        </div>
        <div className="household-card-copy">
          <strong>{name}</strong>
          <div className="household-ownerline">
            <span className="pill pill-on">
              {isOwner ? 'Your household' : 'Shared household'}
            </span>
            <span>You are {role}</span>
          </div>
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
                      friendlyError(
                        caught,
                        'The household couldn’t be switched. Try again.',
                      ),
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
      </div>

      <div className="household-metrics" aria-label="Household summary">
        <div className="household-metric">
          <span>People</span>
          <strong>{memberCount ?? '—'}</strong>
          <small>
            {memberCount === null ? 'Loading membership' : 'In this household'}
          </small>
        </div>
        <div className="household-metric">
          <span>Cameras</span>
          <strong>{cameraCount}</strong>
          <small>Available here</small>
        </div>
        <div className="household-metric">
          <span>Your role</span>
          <strong>{role}</strong>
          <small>
            {isOwner ? 'Full household access' : 'Based on your membership'}
          </small>
        </div>
      </div>

      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}
    </div>
  );
}
