import { useEffect, useState } from 'react';

import { request } from './api';
import {
  accessEventPresentation,
  groupAccessEvents,
  type AccessEvent,
} from './access-history';
import { Icon, type IconName } from './Icon';
import { SettingsCard } from './SettingsUI';

export function AccessHistory({ currentEmail }: { currentEmail: string }) {
  const pageSize = 6;
  const [events, setEvents] = useState<AccessEvent[] | null>(null);
  const [error, setError] = useState('');
  const [page, setPage] = useState(1);

  useEffect(() => {
    let active = true;
    void request<{ events: AccessEvent[] }>('/api/access-history')
      .then((result) => {
        if (active) setEvents(result.events);
      })
      .catch(() => {
        if (active) setError('Camera activity is temporarily unavailable.');
      });
    return () => {
      active = false;
    };
  }, []);

  const groups = events ? groupAccessEvents(events) : [];
  const pageCount = Math.max(1, Math.ceil(groups.length / pageSize));
  const visibleGroups = groups.slice((page - 1) * pageSize, page * pageSize);

  function eventIcon(event: AccessEvent): IconName {
    if (event.eventType === 'live_view_started') return 'eye';
    if (event.eventType === 'live_view_rejected') return 'alert';
    if (event.eventType === 'privacy_enabled') return 'lock';
    if (event.eventType === 'privacy_disabled') return 'eye';
    if (event.eventType === 'device_credential_revoked') return 'shieldOff';
    return 'trash';
  }

  return (
    <SettingsCard aria-label="Recent camera activity">
      <div className="settings-card-header settings-subsection-heading">
        <div>
          <h3>Recent camera activity</h3>
          <p>
            Security-relevant changes and live-view attempts. Up to 50 recent
            events are shown; network addresses, connection details, and camera
            media are never included.
          </p>
        </div>
        {groups.length > 0 && (
          <span className="history-count">
            {groups.length} {groups.length === 1 ? 'event' : 'events'}
          </span>
        )}
      </div>
      {error && (
        <p role="alert" className="settings-card-inline-message">
          {error}
        </p>
      )}
      {events === null && !error && (
        <p role="status" className="settings-card-inline-message">
          Loading camera activity…
        </p>
      )}
      {events?.length === 0 && (
        <p className="settings-card-empty">No camera activity yet.</p>
      )}
      {visibleGroups.length > 0 && (
        <ul className="access-list">
          {visibleGroups.map(({ key, latest, attempts }) => {
            const presentation = accessEventPresentation(latest);
            const target = latest.cameraName
              ? `${latest.cameraName}${latest.deviceName ? ` · ${latest.deviceName}` : ''}`
              : (latest.deviceName ?? 'Camera device');
            const actor = latest.actorEmail
              ? latest.actorEmail === currentEmail
                ? 'By you'
                : `By ${latest.actorEmail}`
              : latest.eventType.startsWith('live_view_')
                ? null
                : 'On camera device';
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
                      {new Date(latest.occurredAt).toLocaleString()}
                    </time>
                  </div>
                  <span className="access-event-target">{target}</span>
                  <div className="access-event-meta">
                    {presentation.detail && <span>{presentation.detail}</span>}
                    {attempts > 1 && (
                      <span>{attempts} connection attempts</span>
                    )}
                    {actor && <span>{actor}</span>}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {pageCount > 1 && (
        <nav className="history-pagination" aria-label="Camera activity pages">
          <button
            className="quiet-button"
            disabled={page === 1}
            onClick={() => setPage((value) => Math.max(1, value - 1))}
            type="button"
          >
            <Icon name="chevronLeft" />
            Previous
          </button>
          <span aria-live="polite">
            Page {page} of {pageCount}
          </span>
          <button
            className="quiet-button"
            disabled={page === pageCount}
            onClick={() => setPage((value) => Math.min(pageCount, value + 1))}
            type="button"
          >
            Next
            <Icon name="chevronRight" />
          </button>
        </nav>
      )}
    </SettingsCard>
  );
}
