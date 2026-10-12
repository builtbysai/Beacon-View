import { useEffect, useRef, useState, useMemo } from 'react';
import { request } from './api';
import { Icon } from './Icon';
import { ConfirmDialog } from './ConfirmDialog';
import {
  activityDateStart,
  activitySince,
  completeThroughEvents,
  localActivityDate,
} from './activity-filters';
import { recordingStatusLabels, recordingStatusTone } from './recording-status';
import './EventsShared.css';
import './MotionEventList.css';

interface MotionEvent {
  id: string;
  cameraId: string;
  cameraName: string;
  deviceName: string;
  confidence: number;
  occurredAt: string;
  recordingId: string | null;
  recordingStatus: string | null;
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
  { id: 'all', label: 'All' },
  { id: 'motion', label: 'Motion' },
  { id: 'system', label: 'Household' },
] as const;

/** What a clip attached to a motion event looks like right now, and
 * whether it can be opened yet -- the shared recording states, worded as
 * an inline call to action ("View clip") rather than a status pill. */
function clipTagFor(
  status: string,
): { label: string; tone: 'link' | 'pending' | 'failed' } | null {
  const label =
    recordingStatusLabels[status as keyof typeof recordingStatusLabels];
  if (!label) return null;
  const tone = recordingStatusTone(status);
  return { label: tone === 'link' ? 'View clip' : label, tone };
}

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
  return ['24', '7', '30', 'since', 'all'].includes(value) ? value : '24';
}

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
  household_mode_changed: 'Home or Away mode changed',
  household_mode_settings_changed: 'Home and Away settings changed',
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

function ClipTag({ status, onOpen }: { status: string; onOpen: () => void }) {
  const tag = clipTagFor(status);
  if (!tag) return null;
  if (tag.tone !== 'link') {
    return (
      <span className={`events-clip-tag is-${tag.tone}`}>{tag.label}</span>
    );
  }
  return (
    <button
      type="button"
      className="events-clip-tag is-link"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
    >
      {tag.label}
    </button>
  );
}

export function MotionEventList({
  filterStorageKey,
  refreshRevision,
  clearRevision = 0,
  cameras,
  onCamera,
  onViewClip,
  includeHouseholdActivity = true,
  focusMotionEventId = null,
  onFocusHandled,
}: {
  filterStorageKey: string;
  refreshRevision: number;
  clearRevision?: number;
  cameras: CameraOption[];
  onCamera: (id: string) => void;
  onViewClip?: (recordingId: string) => void;
  includeHouseholdActivity?: boolean;
  /** A motion event to open in the detail drawer right away, set by the
   * Clips library's "View event" action. Fetched directly by id since it
   * may not be on the page/filters currently loaded here. */
  focusMotionEventId?: string | null;
  onFocusHandled?: () => void;
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
  const [sinceDate, setSinceDate] = useState(() => {
    const saved = savedFilter(`${filterStorageKey}:since`, '');
    return activityDateStart(saved) ? saved : localActivityDate();
  });
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
      if (activityDateStart(sinceDate))
        window.localStorage.setItem(`${filterStorageKey}:since`, sinceDate);
    } catch {
      // Activity filters still work when browser storage is unavailable.
    }
  }, [cameraFilter, filterStorageKey, timeFilter, sinceDate]);

  useEffect(() => {
    if (!focusMotionEventId) return;
    let cancelled = false;
    void request<MotionEvent>(
      `/api/motion-events/${encodeURIComponent(focusMotionEventId)}`,
    )
      .then((event) => {
        if (!cancelled) setDrawerEvent(event);
      })
      .catch(() => {
        if (!cancelled)
          setError('That event could not be found. It may have expired.');
      })
      .finally(() => {
        if (!cancelled) onFocusHandled?.();
      });
    return () => {
      cancelled = true;
    };
  }, [focusMotionEventId]);

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
    if (!includeHouseholdActivity)
      setDrawerEvent((current) =>
        current && !isMotionEvent(current) ? null : current,
      );
    const filters = new URLSearchParams({ limit: '50' });
    if (cameraFilter !== 'all') filters.set('cameraId', cameraFilter);
    const since = activitySince(timeFilter, sinceDate);
    if (since) filters.set('since', since);
    query.current = filters.toString();
    setEvents(null);
    setCursor(null);
    setActivityHasMore(false);
    activityOffset.current = 0;
    if (timeFilter === 'since' && !since) {
      setBusy(false);
      pending.current = false;
      setLoadFailed(false);
      setError('Choose a valid start date.');
    } else void fetchPage(false);
    return () => {
      generation.current += 1;
      controller.current?.abort();
    };
  }, [
    cameraFilter,
    timeFilter,
    sinceDate,
    refreshRevision,
    clearRevision,
    includeHouseholdActivity,
  ]);

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
    let result: ActivityEvent[] = completeThroughEvents<ActivityEvent>(events, [
      { belongs: isMotionEvent, hasMore: cursor !== null },
      { belongs: (event) => !isMotionEvent(event), hasMore: activityHasMore },
    ]);
    if (cameraFilter !== 'all') {
      result = result.filter((event) =>
        isMotionEvent(event)
          ? event.cameraId === cameraFilter
          : event.cameraSourceId === cameraFilter,
      );
    }
    if (timeFilter !== 'all') {
      const start = activitySince(timeFilter, sinceDate);
      const since = start ? new Date(start).getTime() : Infinity;
      result = result.filter(
        (event) =>
          isMotionEvent(event) || new Date(event.occurredAt).getTime() >= since,
      );
    }
    if (kindFilter !== 'all') {
      result = result.filter((event) =>
        kindFilter === 'motion' ? isMotionEvent(event) : !isMotionEvent(event),
      );
    }
    if (search.trim()) {
      const q = search.trim().toLowerCase();
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
  }, [
    events,
    cursor,
    activityHasMore,
    cameraFilter,
    timeFilter,
    sinceDate,
    kindFilter,
    search,
    sortOrder,
  ]);

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
    counts.motion = events?.filter(isMotionEvent).length ?? 0;
    counts.system =
      events?.filter((event) => !isMotionEvent(event)).length ?? 0;
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
                object. Beacon currently reports visual motion only; more
                specific labels such as Person or Vehicle will only appear here
                once a connected device explicitly supports that detection.
              </p>
              <p>
                Beacon's current privacy model stores event metadata rather than
                an image or recording, unless a clip was separately recorded.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="events-controls">
        <label className="events-search">
          <span className="icon-wrapper">
            <Icon name="search" />
          </span>
          <input
            type="search"
            placeholder="Search activity"
            aria-label="Search loaded activity"
            aria-describedby="activity-search-help"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>

        <select
          className="events-select"
          value={cameraFilter}
          onChange={(e) => setCameraFilter(e.target.value)}
          disabled={clearing}
          aria-label="Filter activity by camera"
        >
          <option value="all">All devices</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.deviceName} · {c.name}
            </option>
          ))}
        </select>

        <select
          className="events-select"
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          disabled={clearing}
          aria-label="Filter activity by time"
        >
          <option value="24">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="30">Last 30 days</option>
          <option value="since">Since date</option>
          <option value="all">All time</option>
        </select>
        {timeFilter === 'since' && (
          <label className="activity-since-date">
            Since date
            <input
              type="date"
              value={sinceDate}
              disabled={clearing}
              onChange={(e) => setSinceDate(e.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          className="secondary2"
          disabled={clearing}
          onClick={() => {
            setSearch('');
            setCameraFilter('all');
            setTimeFilter('24');
            setKindFilter('all');
            setSortOrder('new');
          }}
        >
          Reset filters
        </button>
      </section>

      <p id="activity-search-help" className="activity-filter-help">
        Camera and time filters apply to saved history. Search, event type,
        counts, and sorting apply to loaded events.
        {(cursor || activityHasMore) &&
          ' Load more to check additional events in this time range.'}
        {timeFilter === 'since' &&
          ' Dates start at midnight in your local timezone.'}
      </p>

      <div className="events-chips">
        {kinds.map((k) => {
          const count = kindCounts[k.id] ?? 0;
          return (
            <button
              key={k.id}
              className={`events-chip ${kindFilter === k.id ? 'on' : ''}`}
              onClick={() => setKindFilter(k.id)}
              aria-pressed={kindFilter === k.id}
            >
              {k.label} <span className="n">{count}</span>
            </button>
          );
        })}
      </div>

      <div className="events-resultbar">
        <strong role="status" tabIndex={-1} ref={status}>
          {filteredEvents.length}{' '}
          {filteredEvents.length === 1 ? 'event' : 'events'} loaded
        </strong>
        <label className="events-sort">
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
        <div className="events-empty">
          <i>
            <Icon name="activity" />
          </i>
          <h3>
            {cameras.length === 0 ? 'No activity yet.' : 'No matching activity'}
          </h3>
          <p>
            {cameras.length === 0
              ? 'Activity will appear here after you connect a camera.'
              : 'No activity matches these filters in the loaded events.'}
          </p>
        </div>
      )}

      {Array.from(groups, ([day, entries]) => (
        <section className="events-day" key={day} aria-label={day}>
          <h2 className="events-daytitle">{day}</h2>
          <div className="events-feed">
            {entries.map((event) => {
              const kind = isMotionEvent(event) ? 'motion' : 'system';
              const label = activityLabel(event);

              return (
                <article
                  key={event.id}
                  className="events-row"
                  tabIndex={0}
                  role="button"
                  onClick={() => setDrawerEvent(event)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setDrawerEvent(event);
                    }
                  }}
                >
                  <div className={`events-row-icon activity-v3-evicon ${kind}`}>
                    <Icon name="activity" />
                  </div>
                  <div className="events-row-main">
                    <div className="events-row-line">
                      <strong>{label}</strong>
                      <time dateTime={event.occurredAt}>
                        {new Date(event.occurredAt).toLocaleTimeString(
                          undefined,
                          { hour: 'numeric', minute: '2-digit' },
                        )}
                      </time>
                      {isMotionEvent(event) &&
                        event.recordingStatus &&
                        onViewClip && (
                          <ClipTag
                            status={event.recordingStatus}
                            onOpen={() => onViewClip(event.recordingId!)}
                          />
                        )}
                    </div>
                    <div className="events-row-where">
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
                  <span className="events-chev" aria-hidden="true">
                    &rsaquo;
                  </span>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {events && (events.length > 0 || cursor || activityHasMore) && (
        <div className="events-bottom">
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
                className={`events-row-icon activity-v3-evicon ${isMotionEvent(drawerEvent) ? 'motion' : 'system'}`}
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
              {isMotionEvent(drawerEvent) && drawerEvent.recordingStatus && (
                <div className="activity-v3-fact">
                  <span>Clip</span>
                  <span>
                    {recordingStatusLabels[
                      drawerEvent.recordingStatus as keyof typeof recordingStatusLabels
                    ] ?? drawerEvent.recordingStatus}
                  </span>
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
              {(() => {
                const hasClip =
                  isMotionEvent(drawerEvent) &&
                  drawerEvent.recordingStatus === 'available' &&
                  drawerEvent.recordingId &&
                  onViewClip;
                const canOpenCamera =
                  isMotionEvent(drawerEvent) ||
                  (drawerEvent.cameraSourceId &&
                    cameras.some(
                      (camera) => camera.id === drawerEvent.cameraSourceId,
                    ));
                return (
                  <>
                    {hasClip && (
                      <button
                        className="primary"
                        onClick={() => {
                          const recordingId = drawerEvent.recordingId!;
                          setDrawerEvent(null);
                          onViewClip(recordingId);
                        }}
                      >
                        View clip
                      </button>
                    )}
                    {canOpenCamera && (
                      <button
                        className={hasClip ? 'secondary2' : 'primary'}
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
                  </>
                );
              })()}
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
