import { useEffect, useRef, useState } from 'react';
import { request } from './api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';

const timeFilters = [
  { label: '24 hours', value: 'day' },
  { label: '7 days', value: 'week' },
  { label: 'All time', value: 'all' },
] as const;

interface MotionEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  deviceName: string;
  confidence: number;
  occurredAt: string;
}
interface EventPage {
  events: MotionEvent[];
  nextCursor: string | null;
}
interface CameraOption {
  id: string;
  name: string;
  deviceName: string;
}

function savedFilter(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

export function MotionEventList({
  filterStorageKey,
  refreshRevision,
  clearRevision = 0,
  cameras,
  onCamera,
  onAddCamera,
}: {
  filterStorageKey: string;
  refreshRevision: number;
  clearRevision?: number;
  cameras: CameraOption[];
  onCamera: (id: string) => void;
  onAddCamera?: () => void;
}) {
  const [events, setEvents] = useState<MotionEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [reload, setReload] = useState(0);
  const [seenRevision, setSeenRevision] = useState(refreshRevision);
  const [cameraFilter, setCameraFilter] = useState(() =>
    savedFilter(`${filterStorageKey}:camera`, 'all'),
  );
  const [timeFilter, setTimeFilter] = useState(() => {
    const saved = savedFilter(`${filterStorageKey}:time`, 'day');
    return saved === 'week' || saved === 'all' ? saved : 'day';
  });
  const generation = useRef(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const query = useRef('');
  const revision = useRef(refreshRevision);
  const heading = useRef<HTMLHeadingElement | null>(null);
  const status = useRef<HTMLParagraphElement | null>(null);
  revision.current = refreshRevision;

  useEffect(() => {
    try {
      window.localStorage.setItem(`${filterStorageKey}:camera`, cameraFilter);
      window.localStorage.setItem(`${filterStorageKey}:time`, timeFilter);
    } catch {
      /* Filters still work when browser storage is unavailable. */
    }
  }, [cameraFilter, filterStorageKey, timeFilter]);

  async function fetchPage(append: boolean, next: string | null = null) {
    const active = generation.current;
    const abort = new AbortController();
    controller.current = abort;
    pending.current = true;
    setBusy(true);
    setError('');
    setLoadFailed(false);
    try {
      const result = await request<EventPage>(
        `/api/motion-events?${query.current}${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
        { signal: abort.signal },
      );
      if (active !== generation.current) return;
      setEvents((previous) =>
        append
          ? [
              ...(previous ?? []),
              ...result.events.filter(
                (event) => !previous?.some((item) => item.id === event.id),
              ),
            ]
          : result.events,
      );
      setCursor(result.nextCursor ?? null);
    } catch {
      if (active === generation.current) {
        setError('Activity could not be loaded. Your history is still saved.');
        setLoadFailed(true);
      }
    } finally {
      if (active === generation.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  useEffect(() => {
    const filters = new URLSearchParams({ limit: '50' });
    if (cameraFilter !== 'all') filters.set('cameraId', cameraFilter);
    if (timeFilter !== 'all')
      filters.set(
        'since',
        new Date(
          Date.now() - (timeFilter === 'day' ? 1 : 7) * 86_400_000,
        ).toISOString(),
      );
    query.current = filters.toString();
    setEvents(null);
    setCursor(null);
    setSeenRevision(revision.current);
    void fetchPage(false);
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [cameraFilter, timeFilter, reload, clearRevision]);

  function requestClearHistory() {
    if (pending.current || clearing) return;
    setConfirmClear(true);
  }

  async function clearHistory() {
    setConfirmClear(false);
    setClearing(true);
    setError('');
    setLoadFailed(false);
    const active = generation.current;
    try {
      await request<void>('/api/motion-events', { method: 'DELETE' });
      if (active === generation.current) {
        setEvents([]);
        setCursor(null);
        setSeenRevision(revision.current);
        status.current?.focus();
      }
    } catch {
      if (active === generation.current)
        setError('Motion history could not be cleared. Try clearing it again.');
    } finally {
      setClearing(false);
    }
  }

  const groups = new Map<string, MotionEvent[]>();
  for (const event of events ?? []) {
    const day = new Date(event.occurredAt).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    groups.set(day, [...(groups.get(day) ?? []), event]);
  }
  return (
    <section
      className="card wide workspace-medium"
      aria-labelledby="motion-events-title"
    >
      <p className="eyebrow">On-device detection</p>
      <h3 id="motion-events-title" ref={heading} tabIndex={-1}>
        Motion events
      </h3>
      <p className="notice">
        Beacon saves camera, time, and motion intensity, never an image or
        recording.
      </p>
      <div className="event-filters" aria-label="Motion event filters">
        {cameras.length > 0 && (
          <label>
            Camera
            <select
              aria-label="Filter motion events by camera"
              value={cameraFilter}
              disabled={clearing}
              onChange={(event) => setCameraFilter(event.target.value)}
            >
              <option value="all">All cameras</option>
              {cameraFilter !== 'all' &&
                !cameras.some((camera) => camera.id === cameraFilter) && (
                  <option value={cameraFilter}>
                    Previously selected camera
                  </option>
                )}
              {cameras.map((camera) => (
                <option key={camera.id} value={camera.id}>
                  {camera.deviceName} · {camera.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <div
          className="filter-pills"
          role="radiogroup"
          aria-label="Filter motion events by time"
        >
          {timeFilters.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              role="radio"
              aria-checked={timeFilter === value}
              aria-pressed={timeFilter === value}
              disabled={clearing}
              onClick={() => setTimeFilter(value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {refreshRevision !== seenRevision && (
        <button
          type="button"
          className="activity-toast"
          disabled={clearing}
          onClick={() => {
            heading.current?.focus();
            setReload((value) => value + 1);
          }}
        >
          <Icon name="activity" />
          New activity available · Refresh
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      {(busy || events) && (
        <p className="activity-status" role="status" ref={status} tabIndex={-1}>
          {busy
            ? 'Loading motion events…'
            : `${events?.length ?? 0} ${events?.length === 1 ? 'event' : 'events'} shown`}
        </p>
      )}
      {loadFailed && !clearing && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!pending.current) void fetchPage(events !== null, cursor);
          }}
        >
          Retry loading activity
        </button>
      )}
      {events?.length === 0 &&
        (cameras.length === 0 ? (
          <div className="empty">
            <p>No activity yet.</p>
            <p>Motion events will appear here after you connect a camera.</p>
            {onAddCamera && (
              <button type="button" onClick={onAddCamera}>
                <Icon name="plus" />
                Add camera
              </button>
            )}
          </div>
        ) : (
          <div className="empty">
            <p>No activity matches these filters.</p>
            <p>Try a longer time range or another camera.</p>
          </div>
        ))}
      {Array.from(groups, ([day, entries]) => (
        <section className="activity-day" key={day} aria-label={day}>
          <h4>{day}</h4>
          <ol className="activity-timeline">
            {entries.map((event) => (
              <li key={event.id}>
                <span className="activity-icon" aria-hidden="true">
                  <Icon name="activity" />
                </span>
                <div className="activity-row-main">
                  <div className="activity-row-heading">
                    <strong>Motion detected</strong>
                    <time dateTime={event.occurredAt}>
                      {new Date(event.occurredAt).toLocaleTimeString(
                        undefined,
                        { hour: 'numeric', minute: '2-digit' },
                      )}
                    </time>
                  </div>
                  <span>{event.deviceName}</span>
                  <span>{event.cameraName}</span>
                  <details>
                    <summary>Detection details</summary>
                    <p>
                      {Math.round(event.confidence * 100)}% motion intensity
                    </p>
                    <p>
                      Brightness changes can include lighting or shadows. This
                      is not a person or object identification.
                    </p>
                  </details>
                </div>
                {cameras.some((camera) => camera.id === event.cameraId) && (
                  <button
                    className="secondary"
                    type="button"
                    onClick={() => onCamera(event.cameraId)}
                    aria-label={`Open camera: ${event.deviceName}, ${event.cameraName}`}
                  >
                    Open camera
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
      {events && events.length > 0 && (
        <div className="heading-actions">
          <button
            type="button"
            disabled={busy || clearing || !cursor}
            onClick={() => {
              if (!pending.current && cursor) void fetchPage(true, cursor);
            }}
          >
            {cursor ? 'Load older activity' : 'All matching activity shown'}
          </button>
          <button
            className="danger"
            type="button"
            disabled={busy || clearing}
            onClick={requestClearHistory}
          >
            {clearing ? 'Clearing…' : 'Clear motion history'}
          </button>
        </div>
      )}
      {confirmClear && (
        <ConfirmDialog
          title="Clear all motion history?"
          description="This removes all motion-event metadata for this household, including activity outside these filters. This cannot be undone."
          confirmLabel="Clear history"
          onConfirm={() => void clearHistory()}
          onCancel={() => setConfirmClear(false)}
        />
      )}
    </section>
  );
}
