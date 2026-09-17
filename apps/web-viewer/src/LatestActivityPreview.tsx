import { useEffect, useState } from 'react';
import { request } from './api';
import { Icon } from './Icon';

interface MotionEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  deviceName: string;
  confidence: number;
  occurredAt: string;
}

/** A small, static-feeling preview of what's happening -- not the Activity
 * page embedded into Home. No search/filter/sort/pagination here; that
 * belongs on Activity. Beacon's motion-event data only carries a
 * confidence score, not a detection type (person/package/vehicle/...), so
 * unlike Activity's own display this never labels an event as anything
 * more specific than "Motion detected" -- that finer-grained typing isn't
 * something the backend actually reports yet. */
export function LatestActivityPreview({
  refreshRevision,
  onCamera,
}: {
  refreshRevision: number;
  onCamera: (cameraId: string) => void;
}) {
  const [events, setEvents] = useState<MotionEvent[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void request<{ events: MotionEvent[] }>('/api/motion-events?limit=4')
      .then((result) => {
        if (active) setEvents(result.events ?? []);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, [refreshRevision]);

  if (events === null) {
    return (
      <p role="status" className="latest-activity-message">
        {error ? 'Activity is temporarily unavailable.' : 'Loading activity…'}
      </p>
    );
  }

  if (events.length === 0) {
    return <p className="latest-activity-message">No recent activity.</p>;
  }

  return (
    <ul className="latest-activity-list">
      {events.map((event) => (
        <li key={event.id}>
          <button
            type="button"
            className="latest-activity-row"
            onClick={() => onCamera(event.cameraId)}
          >
            <span className="latest-activity-icon">
              <Icon name="activity" />
            </span>
            <span className="latest-activity-copy">
              <strong>Motion detected</strong>
              <small>{event.deviceName || event.cameraName}</small>
            </span>
            <time dateTime={event.occurredAt}>
              {new Date(event.occurredAt).toLocaleTimeString(undefined, {
                hour: 'numeric',
                minute: '2-digit',
              })}
            </time>
          </button>
        </li>
      ))}
    </ul>
  );
}
