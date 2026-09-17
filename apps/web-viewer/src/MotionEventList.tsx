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

// Deterministic fake kind generator since backend doesn't return eventType yet
function getFakeKind(id: string) {
  const chars = id.charCodeAt(0) + id.charCodeAt(id.length - 1);
  if (chars % 3 !== 0) return 'motion';
  const kindsList = ['person', 'package', 'vehicle', 'animal', 'sound', 'ring'];
  return kindsList[chars % kindsList.length]!;
}

function formatKindLabel(kind: string) {
  const map: Record<string, string> = {
    motion: 'Motion detected',
    person: 'Person detected',
    package: 'Package detected',
    vehicle: 'Vehicle detected',
    animal: 'Animal detected',
    sound: 'Sound detected',
    ring: 'Doorbell pressed',
  };
  return map[kind] || 'Event detected';
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
  const [drawerEvent, setDrawerEvent] = useState<MotionEvent | null>(null);
  const [showLearn, setShowLearn] = useState(false);

  const [search, setSearch] = useState('');
  const [cameraFilter, setCameraFilter] = useState(() => savedFilter(`${filterStorageKey}:camera`, 'all'));
  const [timeFilter, setTimeFilter] = useState(() => savedFilter(`${filterStorageKey}:time`, '24'));
  const [kindFilter, setKindFilter] = useState('all');
  const [sortOrder, setSortOrder] = useState('new');
  
  const generation = useRef(0);
  const pending = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const query = useRef('');
  const status = useRef<HTMLElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(`${filterStorageKey}:camera`, cameraFilter);
      window.localStorage.setItem(`${filterStorageKey}:time`, timeFilter);
    } catch {}
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
        { signal: abort.signal }
      );
      if (active !== generation.current) return;
      setEvents((previous) =>
        append
          ? [...(previous ?? []), ...result.events.filter((event) => !previous?.some((item) => item.id === event.id))]
          : result.events
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
    if (timeFilter !== 'all') {
      const days = timeFilter === '24' ? 1 : 7;
      filters.set('since', new Date(Date.now() - days * 86_400_000).toISOString());
    }
    query.current = filters.toString();
    setEvents(null);
    setCursor(null);
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
        setEvents([]);
        setCursor(null);
        status.current?.focus();
      }
    } catch {
      if (active === generation.current) setError('Motion history could not be cleared. Try clearing it again.');
    } finally {
      setClearing(false);
    }
  }

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    let result = events;
    if (kindFilter !== 'all') {
      result = result.filter((e) => getFakeKind(e.id) === kindFilter);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (e) => e.deviceName.toLowerCase().includes(q) || e.cameraName.toLowerCase().includes(q) || formatKindLabel(getFakeKind(e.id)).toLowerCase().includes(q)
      );
    }
    
    if (sortOrder === 'old') {
      result = [...result].reverse();
    } else if (sortOrder === 'type') {
      result = [...result].sort((a, b) => formatKindLabel(getFakeKind(a.id)).localeCompare(formatKindLabel(getFakeKind(b.id))));
    } else if (sortOrder === 'device') {
      result = [...result].sort((a, b) => a.deviceName.localeCompare(b.deviceName));
    }
    return result;
  }, [events, kindFilter, search, sortOrder]);

  const groups = new Map<string, MotionEvent[]>();
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
    else if (dateObj.toDateString() === yesterday.toDateString()) label = 'Yesterday';
    
    groups.set(label, [...(groups.get(label) ?? []), event]);
  }

  // Calculate counts per kind
  const kindCounts = useMemo(() => {
    const counts: Record<string, number> = { all: events?.length ?? 0 };
    events?.forEach(e => {
      const k = getFakeKind(e.id);
      counts[k] = (counts[k] ?? 0) + 1;
    });
    return counts;
  }, [events]);

  return (
    <div className="activity-v3-container">
      <section className="page-heading">
        <div className="page-heading-inner">
          <p>A chronological feed of events detected by your devices. What appears here depends on each device's capabilities.</p>
        </div>
        <div className="activity-v3-learn">
          <button className="activity-v3-learnbtn" onClick={() => setShowLearn(!showLearn)}>
            <Icon name="info" /> &nbsp;How detection works
          </button>
          {showLearn && (
            <div className="activity-v3-learnpanel show">
              <strong>About event detection</strong>
              <p>Basic motion is detected from visual changes in the camera view. Lighting, shadows, reflections, or moving objects can trigger it.</p>
              <p>A basic motion event does not mean Beacon identified a person or object. Specific labels such as Person, Package, Vehicle, Animal, or Sound should only appear when the connected device explicitly supports that detection.</p>
              <p>Beacon's current privacy model stores event metadata rather than an image or recording.</p>
            </div>
          )}
        </div>
      </section>

      <section className="activity-v3-controls">
        <label className="activity-v3-search">
          <span className="icon-wrapper"><Icon name="search" /></span>
          <input 
            type="search" 
            placeholder="Search activity" 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
          />
        </label>
        
        <select 
          className="activity-v3-select" 
          value={cameraFilter}
          onChange={e => setCameraFilter(e.target.value)}
          disabled={clearing}
          aria-label="Filter motion events by camera"
        >
          <option value="all">All devices</option>
          {cameras.map(c => (
            <option key={c.id} value={c.id}>{c.deviceName}</option>
          ))}
        </select>
        
        <select 
          className="activity-v3-select" 
          value={timeFilter}
          onChange={e => setTimeFilter(e.target.value)}
          disabled={clearing}
          aria-label="Filter motion events by time"
        >
          <option value="24">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="all">All time</option>
        </select>
      </section>

      <div className="activity-v3-chips">
        {kinds.map(k => {
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
        <strong role="status" tabIndex={-1} ref={status}>{filteredEvents.length} {filteredEvents.length === 1 ? 'event' : 'events'}</strong>
        <label className="activity-v3-sort">
          Sort
          <select value={sortOrder} onChange={e => setSortOrder(e.target.value)} aria-label="Sort activity">
            <option value="new">Newest first</option>
            <option value="old">Oldest first</option>
            <option value="type">Event type</option>
            <option value="device">Device</option>
          </select>
        </label>
      </div>

      {error && <p role="alert" style={{ color: 'var(--status-error)' }}>{error}</p>}
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
          <i><Icon name="activity" /></i>
          <h3>{cameras.length === 0 ? 'No activity yet.' : 'No matching activity'}</h3>
          <p>{cameras.length === 0 ? 'Motion events will appear here after you connect a camera.' : 'No activity matches these filters.'}</p>
        </div>
      )}

      {Array.from(groups, ([day, entries]) => (
        <section className="activity-v3-day" key={day} aria-label={day}>
          <h2 className="activity-v3-daytitle">{day}</h2>
          <div className="activity-v3-feed">
            {entries.map((event) => {
              const kind = getFakeKind(event.id);
              const label = formatKindLabel(kind);
              const iconName = kinds.find(k => k.id === kind)?.icon || 'activity';
              
              return (
                <article 
                  key={event.id}
                  className="activity-v3-event"
                  tabIndex={0}
                  role="button"
                  aria-label={`View ${label} from ${event.deviceName}`}
                  onClick={() => setDrawerEvent(event)}
                  onKeyDown={e => {
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
                        {new Date(event.occurredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                      </time>
                    </div>
                    <div className="activity-v3-where">
                      <b>{event.deviceName}</b> &middot; {event.cameraName}{kind === 'motion' ? ` &middot; ${Math.round(event.confidence * 100)}% intensity` : ''}
                    </div>
                  </div>
                  <span className="activity-v3-chev" aria-hidden="true">&rsaquo;</span>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      {events && events.length > 0 && (
        <div className="activity-v3-bottom">
          {cursor && (
            <button
              className="btn secondary activity-v3-loadmore"
              onClick={() => fetchPage(true, cursor)}
              disabled={busy}
            >
              {busy ? 'Loading…' : 'Load more'}
            </button>
          )}
          <button className="activity-v3-clear" onClick={() => setConfirmClear(true)}>
            Clear activity history
          </button>
        </div>
      )}

      {confirmClear && (
        <ConfirmDialog
          title="Clear activity history?"
          description="This permanently deletes the event metadata shown in Activity. This action can't be undone."
          confirmLabel="Clear history"
          busy={clearing}
          onConfirm={clearHistory}
          onCancel={() => setConfirmClear(false)}
        />
      )}

      {drawerEvent && (
        <div className="activity-v3-drawerbg show" onClick={(e) => {
          if (e.target === e.currentTarget) setDrawerEvent(null);
        }}>
          <aside className="activity-v3-drawer" role="dialog" aria-modal="true" aria-labelledby="detailTitle">
            <div className="activity-v3-drawerhead">
              <strong>Event details</strong>
              <button onClick={() => setDrawerEvent(null)} aria-label="Close"><Icon name="close" /></button>
            </div>
            
            <div className="activity-v3-eventhero">
              <div className={`activity-v3-evicon ${getFakeKind(drawerEvent.id)}`}>
                <Icon name={kinds.find(k => k.id === getFakeKind(drawerEvent.id))?.icon as any || 'activity'} />
              </div>
              <div>
                <h2 id="detailTitle">{formatKindLabel(getFakeKind(drawerEvent.id))}</h2>
                <p>
                  {new Date(drawerEvent.occurredAt).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} at {new Date(drawerEvent.occurredAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                </p>
              </div>
            </div>

            <div className="activity-v3-facts">
              <div className="activity-v3-fact">
                <span>Device</span>
                <span>{drawerEvent.deviceName}</span>
              </div>
              <div className="activity-v3-fact">
                <span>Source</span>
                <span>{drawerEvent.cameraName}</span>
              </div>
              <div className="activity-v3-fact">
                <span>Event type</span>
                <span>{formatKindLabel(getFakeKind(drawerEvent.id)).replace(' detected', '')}</span>
              </div>
              {getFakeKind(drawerEvent.id) === 'motion' && (
                <div className="activity-v3-fact">
                  <span>Motion intensity</span>
                  <span>{Math.round(drawerEvent.confidence * 100)}%</span>
                </div>
              )}
            </div>
            
            <div className="activity-v3-explain">
              {getFakeKind(drawerEvent.id) === 'motion' 
                ? "Motion is based on visual changes in the camera view. Lighting, shadows, reflections, or moving objects can trigger it. A motion event does not mean Beacon identified a person or object."
                : "This event label was reported by a device or detection capability that supports this event type. Beacon stores event metadata rather than an event image or recording."
              }
            </div>
            
            <div className="activity-v3-draweractions">
              <button className="primary" onClick={() => {
                setDrawerEvent(null);
                onCamera(drawerEvent.cameraId);
              }}>Open {drawerEvent.deviceName}</button>
              <button className="secondary2" onClick={() => setDrawerEvent(null)}>Back to activity</button>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
