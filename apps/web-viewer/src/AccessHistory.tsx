import { useEffect, useState } from 'react';

import { request } from './api';
import {
  accessEventPresentation,
  groupAccessEvents,
  type AccessEvent,
} from './access-history';
import { Icon, type IconName } from './Icon';
import { SecurityActivityDialog } from './SecurityActivityDialog';

const PREVIEW_COUNT = 5;

function eventIcon(event: AccessEvent): IconName {
  if (event.eventType === 'live_view_started') return 'eye';
  if (event.eventType === 'live_view_rejected') return 'alert';
  if (event.eventType === 'privacy_enabled') return 'lock';
  if (event.eventType === 'privacy_disabled') return 'eye';
  if (event.eventType === 'device_credential_revoked') return 'shieldOff';
  return 'trash';
}

/** A quiet preview -- the last few meaningful security events, not the
 * whole audit log embedded in Settings. "View all" opens the real
 * paginated experience (SecurityActivityDialog). */
export function AccessHistory({ currentEmail }: { currentEmail: string }) {
  const [events, setEvents] = useState<AccessEvent[] | null>(null);
  const [error, setError] = useState('');
  const [fullViewOpen, setFullViewOpen] = useState(false);

  useEffect(() => {
    let active = true;
    void request<{ events: AccessEvent[] }>(
      `/api/access-history?limit=${PREVIEW_COUNT}`,
    )
      .then((result) => {
        if (active) setEvents(result.events);
      })
      .catch(() => {
        if (active)
          setError('Recent access couldn’t be loaded. Try again in a moment.');
      });
    return () => {
      active = false;
    };
  }, []);

  const groups = events ? groupAccessEvents(events) : [];

  return (
    <section aria-label="Recent access" className="settings-subsection">
      <h3>Recent access</h3>
      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}
      {events === null && !error && (
        <p role="status" className="settings-card-inline-message">
          Loading…
        </p>
      )}
      {events?.length === 0 && (
        <p className="settings-card-empty">No recent access events.</p>
      )}
      {groups.length > 0 && (
        <ul className="access-list access-list-preview">
          {groups.map(({ key, latest, attempts }) => {
            const presentation = accessEventPresentation(latest);
            const target = latest.cameraName
              ? `${latest.cameraName}${latest.deviceName ? ` · ${latest.deviceName}` : ''}`
              : (latest.deviceName ?? 'Camera device');
            return (
              <li
                className={`access-event access-event--${presentation.tone}`}
                key={key}
              >
                <span className="access-event-icon">
                  <Icon name={eventIcon(latest)} />
                </span>
                <div className="access-event-body">
                  <div className="access-event-heading">
                    <strong>{presentation.label}</strong>
                    <time dateTime={latest.occurredAt}>
                      {new Date(latest.occurredAt).toLocaleTimeString(
                        undefined,
                        { hour: 'numeric', minute: '2-digit' },
                      )}
                    </time>
                  </div>
                  <span className="access-event-target">
                    {target}
                    {attempts > 1 && ` · ${attempts} attempts`}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {events !== null && (
        <button
          type="button"
          className="textbtn"
          onClick={() => setFullViewOpen(true)}
        >
          View all security activity &rarr;
        </button>
      )}
      {fullViewOpen && (
        <SecurityActivityDialog
          currentEmail={currentEmail}
          onDismiss={() => setFullViewOpen(false)}
        />
      )}
    </section>
  );
}
