import { useEffect, useRef, useState, useMemo } from 'react';
import { request } from './api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import './MotionEventList.css';

interface MotionEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  deviceName: string;
  confidence: number;
  occurredAt: string;
  eventType?: never;
}

interface HouseholdEvent {
  id: string;
  actorEmail: string | null;
  householdId: string;
  publicDeviceId: string | null;
  cameraSourceId: string | null;
  deviceName: string | null;
  sourceName: string | null;
  eventType: string;
  occurredAt: string;
  success: boolean;
  metadata: Record<string, string>;
}

type ActivityEvent = MotionEvent | HouseholdEvent;

interface HouseholdEventPage {
  events: HouseholdEvent[];
  total: number;
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

const kinds = [
  { id: 'all', label: 'All', icon: '' },
  { id: 'motion', label: 'Motion', icon: 'activity' },
  { id: 'person', label: 'Person', icon: 'user' },
  { id: 'package', label: 'Package', icon: 'package' },
  { id: 'vehicle', label: 'Vehicle', icon: 'car' },
  { id: 'animal', label: 'Animal', icon: 'animal' },
  { id: 'sound', label: 'Sound', icon: 'sound' },
  { id: 'ring', label: 'Doorbell', icon: 'bell' },
] as const;

function savedFilter(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function savedTimeFilter(key: string): string {
  const value = savedFilter(key, '24');
  if (value === 'day') return '24';
  if (value === 'week') return '7';
  return ['24', '7', 'all'].includes(value) ? value : '24';
}

// /api/motion-events currently reports visual motion only. More specific
// detection labels require an explicit device-reported event type.
const motionKind = 'motion';

const activityLabels: Record<string, string> = {
  camera_source_added: 'Camera source added',
  camera_source_deleted: 'Camera source removed',
  camera_source_updated: 'Camera source updated',
  camera_updated: 'Camera updated',
  device_paired: 'Device paired',
  device_reconnected: 'Device reconnected',
  device_offline: 'Device went offline',
  device_recovered: 'Device recovered',
  device_updated: 'Device updated',
  device_deleted: 'Device removed',
  device_credential_revoked: 'Device access revoked',
  device_self_removed: 'Device removed itself',
  device_self_disconnected: 'Device disconnected',
  privacy_enabled: 'Privacy mode enabled',
  privacy_disabled: 'Privacy mode disabled',
  household_invitation_created: 'Invitation created',
  household_invitation_resent: 'Invitation resent',
  household_invitation_accepted: 'Invitation accepted',
  household_invitation_revoked: 'Invitation revoked',
  household_member_removed: 'Member removed',
  household_member_revoked: 'Member access revoked',
  household_camera_grants_changed: 'Camera access changed',
  camera_access_left: 'Camera access left',
  recording_requested: 'Recording requested',
  recording_available: 'Recording available',
  recording_failed: 'Recording failed',
  recording_deleted: 'Recording deleted',
  live_view_started: 'Live view started',
  live_view_rejected: 'Live view rejected',
  motion_settings_changed: 'Motion settings changed',
  motion_history_cleared: 'Motion history cleared',
  motion_retention_changed: 'Motion retention changed',
  notification_preference_changed: 'Notification preferences changed',
  notification_subscription_created: 'Notification delivery enabled',
  notification_subscription_revoked: 'Notification delivery disabled',
};

function isMotionEvent(event: ActivityEvent): event is MotionEvent {
  return event.eventType === undefined;
}

function activityLabel(event: ActivityEvent): string {
  if (isMotionEvent(event)) return 'Motion detected';
  if (event.eventType === 'camera_updated' && event.metadata.cameraName)
    return 'Camera renamed';
  if (event.eventType === 'device_updated' && event.metadata.deviceName)
    return 'Device renamed';
  return (
    activityLabels[event.eventType] ?? event.eventType.replaceAll('_', ' ')
  );
}

function activityDeviceName(event: ActivityEvent): string {
  return event.deviceName || 'Household';
}

function activitySourceName(event: ActivityEvent): string | null {
  return isMotionEvent(event) ? event.cameraName : event.sourceName;
}

export function MotionEventList({
  filterStorageKey,
  refreshRevision,
  clearRevision = 0,
  cameras,
  onCamera,
  includeHouseholdActivity = true,
}: {
  filterStorageKey: string;
  refreshRevision: number;
  clearRevision?: number;
  cameras: CameraOption[];
  onCamera: (id: string) => void;
  includeHouseholdActivity?: boolean;
}) {
  const [events, setEvents] = useState<ActivityEvent[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [activityHasMore, setActivityHasMore] = useState(false);
  const [error, setError] = useState('');
  const [loadFailed, setLoadFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const [clearing, setClearing] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const [drawerEvent, setDrawerEvent] = useState<ActivityEvent | null>(null);
  const [showLearn, setShowLearn] = useState(false);

  const [search, setSearch] = useState('');
  const [cameraFilter, setCameraFilter] = useState(() =>
    savedFilter(`${filterStorageKey}:camera`, 'all'),
  );
  const [timeFilter, setTimeFilter] = useState(() =>
    savedTimeFilter(`${filterStorageKey}:time`),
  );
  const [kindFilter, setKindFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('new');

  const generation = useRef(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const query = useRef('');
  const activityOffset = useRef(0);
  const status = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${filterStorageKey}:camera`, cameraFilter);
      window.localStorage.setItem(`${filterStorageKey}:time`, timeFilter);
    } catch {
      // Activity filters still work when browser storage is unavailable.
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
      const [motionPage, activityPage] = await Promise.all([
        next !== null || !append || cursor !== null
          ? request<EventPage>(
              `/api/motion-events?${query.current}${next ? `&cursor=${encodeURIComponent(next)}` : ''}`,
              { signal: abort.signal },
            )
          : Promise.resolve<EventPage>({ events: [], nextCursor: null }),
        includeHouseholdActivity && (!append || activityHasMore)
          ? request<HouseholdEventPage>(
              `/api/activity?${query.current}&offset=${append ? activityOffset.current : 0}`,
              { signal: abort.signal },
            )
          : Promise.resolve<HouseholdEventPage>({
              events: [],
              total: activityOffset.current,
            }),
      ]);
      if (active !== generation.current) return;
      activityOffset.current = append
        ? activityOffset.current + activityPage.events.length
        : activityPage.events.length;
      setActivityHasMore(activityOffset.current < activityPage.total);
      const pageEvents: ActivityEvent[] = [
        ...motionPage.events,
        ...activityPage.events,
      ];
      setEvents((previous) =>
        append
          ? [
              ...(previous ?? []),
              ...pageEvents.filter(
                (event) => !previous?.some((item) => item.id === event.id),
              ),
            ]
          : pageEvents,
      );
      setCursor(motionPage.nextCursor ?? null);
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
    if (timeFilter !== 'all') {
      const days = timeFilter === '24' ? 1 : 7;
      filters.set(
        'since',
        new Date(Date.now() - days * 86_400_000).toISOString(),
      );
    }
    query.current = filters.toString();
    setEvents(null);
    setCursor(null);
    setActivityHasMore(false);
    activityOffset.current = 0;
    void fetchPage(false);
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [cameraFilter, timeFilter, refreshRevision, clearRevision]);

  async function clearHistory() {
    setConfirmClear(false);
    setClearing(true);
    setError('');
    const active = generation.current;
    try {
      await request<void>('/api/motion-events', { method: 'DELETE' });
      if (active === generation.current) {
        setEvents(
          (previous) =>
            previous?.filter((event) => !isMotionEvent(event)) ?? [],
        );
        setCursor(null);
        status.current?.focus();
      }
    } catch {
      if (active === generation.current)
        setError('Motion history could not be cleared. Try clearing it again.');
    } finally {
      setClearing(false);
    }
  }

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    let result = events;
    if (cameraFilter !== 'all') {
      result = result.filter((event) =>
        isMotionEvent(event)
          ? event.cameraId === cameraFilter
          : event.cameraSourceId === cameraFilter,
      );
    }
    if (timeFilter !== 'all') {
      const since = Date.now() - (timeFilter === '24' ? 1 : 7) * 86_400_000;
      result = result.filter(
        (event) =>
          isMotionEvent(event) || new Date(event.occurredAt).getTime() >= since,
      );
    }
    if (kindFilter !== 'all') {
      result = result.filter(
        (event) => kindFilter === motionKind && isMotionEvent(event),
      );
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) =>
          activityDeviceName(e).toLowerCase().includes(q) ||
          (activitySourceName(e) ?? '').toLowerCase().includes(q) ||
          (!isMotionEvent(e) ? (e.actorEmail ?? '') : '')
            .toLowerCase()
            .includes(q) ||
          activityLabel(e).toLowerCase().includes(q),
      );
    }

    if (sortOrder === 'old') {
      result = [...result].sort((a, b) =>
        a.occurredAt.localeCompare(b.occurredAt),
      );
    } else if (sortOrder === 'type') {
      result = [...result].sort(
        (a, b) =>
          activityLabel(a).localeCompare(activityLabel(b)) ||
          b.occurredAt.localeCompare(a.occurredAt),
      );
    } else if (sortOrder === 'device') {
      result = [...result].sort(
        (a, b) =>
          activityDeviceName(a).localeCompare(activityDeviceName(b)) ||
          b.occurredAt.localeCompare(a.occurredAt),
      );
    } else {
      result = [...result].sort((a, b) =>
        b.occurredAt.localeCompare(a.occurredAt),
      );
    }
    return result;
  }, [events, cameraFilter, timeFilter, kindFilter, search, sortOrder]);

  const groups = new Map<string, ActivityEvent[]>();
  for (const event of filteredEvents) {
    const day = new Date(event.occurredAt).toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    // Format "Today" and "Yesterday" if applicable
    const dateObj = new Date(event.occurredAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    let label = day;
    if (dateObj.toDateString() === today.toDateString()) label = 'Today';
    else if (dateObj.toDateString() === yesterday.toDateString())
      label = 'Yesterday';

    groups.set(label, [...(groups.get(label) ?? []), event]);
  }

  // Calculate counts per kind
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: events?.length ?? 0 };
    counts[motionKind] = events?.filter(isMotionEvent).length ?? 0;
    return counts;
  }, [events]);

  return (
    <div className="activity-v3-container">
      <section className="page-heading">
        <div className="page-heading-inner">
          <p>
            A chronological feed of events detected by your devices. What
            appears here depends on each device's capabilities.
          </p>
        </div>
        <div className="activity-v3-learn">
          <button
            className="activity-v3-learnbtn"
            onClick={() => setShowLearn(!showLearn)}
          >
            <Icon name="info" /> &nbsp;How detection works
          </button>
          {showLearn && (
            <div className="activity-v3-learnpanel show">
              <strong>About event detection</strong>
              <p>
                Basic motion is detected from visual changes in the camera view.
                Lighting, shadows, reflections, or moving objects can trigger
                it.
              </p>
              <p>
                A basic motion event does not mean Beacon identified a person or
                object. Specific labels such as Person, Package, Vehicle,
                Animal, or Sound should only appear when the connected device
                explicitly supports that detection.
              </p>
              <p>
                Beacon's current privacy model stores event metadata rather than
                an image or recording.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="activity-v3-controls">
        <label className="activity-v3-search">
          <span className="icon-wrapper">
            <Icon name="search" />
          </span>
          <input
            type="search"
            placeholder="Search activity"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <select
          className="activity-v3-select"
          value={cameraFilter}
          onChange={(e) => setCameraFilter(e.target.value)}
          disabled={clearing}
          aria-label="Filter activity by camera"
        >
          <option value="all">All devices</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.deviceName}
            </option>
          ))}
        </select>

        <select
          className="activity-v3-select"
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          disabled={clearing}
          aria-label="Filter activity by time"
        >
          <option value="24">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="all">All time</option>
        </select>
      </section>

      <div className="activity-v3-chips">
        {kinds.map((k) => {
          const count = kindCounts[k.id] ?? 0;
          return (
            <button
              key={k.id}
              className={`activity-v3-chip ${kindFilter === k.id ? 'on' : ''}`}
              onClick={() => setKindFilter(k.id)}
            >
              {k.label} <span className="n">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="activity-v3-resultbar">
        <strong role="status" tabIndex={-1} ref={status}>
          {filteredEvents.length}{' '}
          {filteredEvents.length === 1 ? 'event' : 'events'}
        </strong>
        <label className="activity-v3-sort">
          Sort
          <select
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            aria-label="Sort activity"
          >
            <option value="new">Newest first</option>
            <option value="old">Oldest first</option>
            <option value="type">Event type</option>
            <option value="device">Device</option>
          </select>
        </label>
      </div>

      {error && (
        <p role="alert" style={{ color: 'var(--status-error)' }}>
          {error}
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

      {filteredEvents.length === 0 && (
        <div className="activity-v3-empty">
          <i>
            <Icon name="activity" />
          </i>
          <h3>
            {cameras.length === 0 ? 'No activity yet.' : 'No matching activity'}
          </h3>
          <p>
            {cameras.length === 0
              ? 'Activity will appear here after you connect a camera.'
              : 'No activity matches these filters.'}
          </p>
        </div>
      )}

      {Array.from(groups, ([day, entries]) => (
        <section className="activity-v3-day" key={day} aria-label={day}>
          <h2 className="activity-v3-daytitle">{day}</h2>
          <div className="activity-v3-feed">
            {entries.map((event) => {
              const kind = isMotionEvent(event) ? motionKind : 'system';
              const label = activityLabel(event);
              const iconName = 'activity';

              return (
                <article
                  key={event.id}
                  className="activity-v3-event"
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${label} from ${activityDeviceName(event)}`}
                  onClick={() => setDrawerEvent(event)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDrawerEvent(event);
                    }
                  }}
                >
                  <div className={`activity-v3-evicon ${kind}`}>
                    <Icon name={iconName} />
                  </div>
                  <div className="activity-v3-evmain">
                    <div className="activity-v3-evline">
                      <strong>{label}</strong>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleTimeString(
                          undefined,
                          { hour: 'numeric', minute: '2-digit' },
                        )}
                      </time>
                    </div>
                    <div className="activity-v3-where">
                      <b>{activityDeviceName(event)}</b>
                      {isMotionEvent(event) ? (
                        <>
                          {' '}
                          &middot; {event.cameraName} &middot;{' '}
                          {Math.round(event.confidence * 100)}% intensity
                        </>
                      ) : activitySourceName(event) ? (
                        <> &middot; {activitySourceName(event)}</>
                      ) : null}
                    </div>
                  </div>
                  <span className="activity-v3-chev" aria-hidden="true">
                    &rsaquo;
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {events && events.length > 0 && (
        <div className="activity-v3-bottom">
          {(cursor || activityHasMore) && (
            <button
              className="btn secondary activity-v3-loadmore"
              onClick={() => void fetchPage(true, cursor)}
              disabled={busy}
            >
              {busy ? 'Loading…' : 'Load more'}
            </button>
          )}
          {events.some(isMotionEvent) && (
            <button
              className="activity-v3-clear"
              onClick={() => setConfirmClear(true)}
            >
              Clear motion history
            </button>
          )}
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear motion history?"
          description="This permanently deletes motion event metadata. Household activity remains. This action can't be undone."
          confirmLabel="Clear history"
          busy={clearing}
          onConfirm={() => void clearHistory()}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {drawerEvent && (
        <div
          className="activity-v3-drawerbg show"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDrawerEvent(null);
          }}
        >
          <aside
            className="activity-v3-drawer"
            role="dialog"
            aria-modal="true"
            aria-labelledby="detailTitle"
          >
            <div className="activity-v3-drawerhead">
              <strong>Event details</strong>
              <button onClick={() => setDrawerEvent(null)} aria-label="Close">
                <Icon name="close" />
              </button>
            </div>

            <div className="activity-v3-eventhero">
              <div
                className={`activity-v3-evicon ${isMotionEvent(drawerEvent) ? motionKind : 'system'}`}
              >
                <Icon name="activity" />
              </div>
              <div>
                <h2 id="detailTitle">{activityLabel(drawerEvent)}</h2>
                <p>
                  {new Date(drawerEvent.occurredAt).toLocaleDateString(
                    undefined,
                    {
                      weekday: 'long',
                      year: 'numeric',
                      month: 'long',
                      day: 'numeric',
                    },
                  )}{' '}
                  at{' '}
                  {new Date(drawerEvent.occurredAt).toLocaleTimeString(
                    undefined,
                    { hour: 'numeric', minute: '2-digit' },
                  )}
                </p>
              </div>
            </div>

            <div className="activity-v3-facts">
              <div className="activity-v3-fact">
                <span>Device</span>
                <span>{activityDeviceName(drawerEvent)}</span>
              </div>
              {activitySourceName(drawerEvent) && (
                <div className="activity-v3-fact">
                  <span>Source</span>
                  <span>{activitySourceName(drawerEvent)}</span>
                </div>
              )}
              {!isMotionEvent(drawerEvent) && drawerEvent.actorEmail && (
                <div className="activity-v3-fact">
                  <span>Actor</span>
                  <span>{drawerEvent.actorEmail}</span>
                </div>
              )}
              <div className="activity-v3-fact">
                <span>Event type</span>
                <span>
                  {activityLabel(drawerEvent).replace(' detected', '')}
                </span>
              </div>
              {isMotionEvent(drawerEvent) && (
                <div className="activity-v3-fact">
                  <span>Motion intensity</span>
                  <span>{Math.round(drawerEvent.confidence * 100)}%</span>
                </div>
              )}
            </div>

            {isMotionEvent(drawerEvent) && (
              <div className="activity-v3-explain">
                Motion is based on visual changes in the camera view. Lighting,
                shadows, reflections, or moving objects can trigger it. A motion
                event does not mean Beacon identified a person or object.
              </div>
            )}

            <div className="activity-v3-draweractions">
              {(isMotionEvent(drawerEvent) ||
                (drawerEvent.cameraSourceId &&
                  cameras.some(
                    (camera) => camera.id === drawerEvent.cameraSourceId,
                  ))) && (
                <button
                  className="primary"
                  onClick={() => {
                    setDrawerEvent(null);
                    onCamera(
                      isMotionEvent(drawerEvent)
                        ? drawerEvent.cameraId
                        : drawerEvent.cameraSourceId!,
                    );
                  }}
                >
                  Open {activityDeviceName(drawerEvent)}
                </button>
              )}
              <button
                className="secondary2"
                onClick={() => setDrawerEvent(null)}
              >
                Back to activity
              </button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
