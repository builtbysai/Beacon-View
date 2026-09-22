import { useEffect, useState } from 'react';

import { request } from './api';
import {
  accessEventPresentation,
  groupAccessEvents,
  type AccessEvent,
} from './access-history';
import { Icon, type IconName } from './Icon';
import { ModalDialog } from './ModalDialog';
import { pushRoute, replaceRoute } from './history-nav';

const PAGE_SIZE = 20;
const OFFSET_PARAM = 'securityOffset';

function eventIcon(event: AccessEvent): IconName {
  if (event.eventType === 'live_view_started') return 'eye';
  if (event.eventType === 'live_view_rejected') return 'alert';
  if (event.eventType === 'privacy_enabled') return 'lock';
  if (event.eventType === 'privacy_disabled') return 'eye';
  if (event.eventType === 'device_credential_revoked') return 'shieldOff';
  return 'trash';
}

function offsetFromUrl(): number {
  const value = Number(
    new URLSearchParams(window.location.search).get(OFFSET_PARAM),
  );
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function withOffset(offset: number): string {
  const url = new URL(window.location.href);
  if (offset > 0) url.searchParams.set(OFFSET_PARAM, String(offset));
  else url.searchParams.delete(OFFSET_PARAM);
  return `${url.pathname}${url.search}`;
}

/** The complete, paginated security/audit history -- a focused sheet
 * rather than a page embedded in Settings, because exploring history is a
 * different task from configuring preferences. Uses the backend's real
 * offset/limit pagination (see /api/access-history), never fetches more
 * than one page's worth of events at a time. */
export function SecurityActivityDialog({
  onDismiss,
}: {
  currentEmail: string;
  onDismiss: () => void;
}) {
  const [offset, setOffset] = useState(offsetFromUrl);
  const [page, setPage] = useState<{
    events: AccessEvent[];
    total: number;
  } | null>(null);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(false);
    void request<{ events: AccessEvent[]; total: number }>(
      `/api/access-history?limit=${PAGE_SIZE}&offset=${offset}`,
    )
      .then((result) => {
        if (active) setPage(result);
      })
      .catch(() => {
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [offset]);

  useEffect(() => {
    // The dialog owns this one query param while it's open; hand the URL
    // back exactly as it was once it closes.
    const opened = window.location.href;
    return () => {
      if (window.location.search.includes(OFFSET_PARAM)) {
        const url = new URL(opened);
        url.searchParams.delete(OFFSET_PARAM);
        replaceRoute(`${url.pathname}${url.search}`);
      }
    };
  }, []);

  function goTo(nextOffset: number) {
    pushRoute(withOffset(nextOffset));
    setOffset(nextOffset);
  }

  const total = page?.total ?? 0;
  const groups = page ? groupAccessEvents(page.events) : [];
  const rangeStart = total === 0 ? 0 : offset + 1;
  const rangeEnd = Math.min(offset + (page?.events.length ?? 0), total);

  return (
    <ModalDialog labelledBy="security-activity-title" onDismiss={onDismiss}>
      <section
        aria-labelledby="security-activity-title"
        className="security-activity-dialog"
      >
        <div className="favorites-editor-header">
          <div>
            <h2 id="security-activity-title">Security activity</h2>
            <p>Camera access and account security events for this household.</p>
          </div>
          <button
            type="button"
            className="icon-button"
            aria-label="Close"
            onClick={onDismiss}
          >
            <Icon name="close" />
          </button>
        </div>

        <div className="security-activity-body">
          {error && (
            <p role="alert" className="settings-card-inline-message">
              Security activity could not be loaded.
            </p>
          )}
          {loading && !page && (
            <p role="status" className="settings-card-inline-message">
              Loading…
            </p>
          )}
          {page && groups.length === 0 && (
            <p className="settings-card-empty">No security activity yet.</p>
          )}
          {groups.length > 0 && (
            <ul className="access-list">
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
                          {new Date(latest.occurredAt).toLocaleString()}
                        </time>
                      </div>
                      <span className="access-event-target">{target}</span>
                      <div className="access-event-meta">
                        {presentation.detail && (
                          <span>{presentation.detail}</span>
                        )}
                        {attempts > 1 && (
                          <span>{attempts} connection attempts</span>
                        )}
                        {latest.actorEmail && (
                          <span>By {latest.actorEmail}</span>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {total > 0 && (
          <nav
            aria-label="Security activity pages"
            className="security-activity-pagination"
          >
            <span>
              {rangeStart}–{rangeEnd} of {total}
            </span>
            <div className="security-activity-pagination-controls">
              <button
                type="button"
                className="secondary"
                disabled={offset === 0 || loading}
                onClick={() => goTo(Math.max(0, offset - PAGE_SIZE))}
              >
                Previous
              </button>
              <button
                type="button"
                className="secondary"
                disabled={rangeEnd >= total || loading}
                onClick={() => goTo(offset + PAGE_SIZE)}
              >
                Next
              </button>
            </div>
          </nav>
        )}
      </section>
    </ModalDialog>
  );
}
