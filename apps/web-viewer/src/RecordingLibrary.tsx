import { useEffect, useMemo, useRef, useState } from 'react';

import { request } from './api';
import { friendlyError } from './friendly-errors';
import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { downloadBlob } from './browser-download';
import {
  extensionForRecordingMime,
  loadRecordingForPlayback,
  loadRecordingThumbnail,
} from './recording-playback';
import { recordingStatusLabels } from './recording-status';
import { ShareClipDialog } from './ShareClipDialog';
import './EventsShared.css';
import './RecordingLibrary.css';

interface RecordingSummary {
  id: string;
  cameraId: string;
  cameraName: string;
  deviceName: string;
  status:
    | 'requested'
    | 'recording'
    | 'uploading'
    | 'available'
    | 'failed'
    | 'deleting';
  durationMs: number | null;
  createdAt: string;
  triggerMotionEventId?: string | null;
  hasThumbnail?: boolean;
}

/** Fetches and decrypts a clip's thumbnail lazily, once, when this row is
 * rendered -- falling back to the generic icon silently on any failure
 * (missing, not yet uploaded, or this viewer lacks camera access). */
function ClipThumbnail({ recordingId }: { recordingId: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;
    void loadRecordingThumbnail(recordingId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        // The generic icon below covers every failure case.
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [recordingId]);

  return url ? (
    <img className="clips-thumb-image" src={url} alt="" />
  ) : (
    <Icon name="film" />
  );
}

interface CameraOption {
  id: string;
  name: string;
  deviceName: string;
}

function recordingTime(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatDuration(ms: number | null | undefined): string | null {
  if (!ms || ms <= 0) return null;
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function RecordingLibrary({
  cameras = [],
  canDelete = false,
  canShare = false,
  onOpenEvent,
  focusRecordingId = null,
  onFocusHandled,
  bookmarkStorageKey,
}: {
  bookmarkStorageKey?: string;
  cameras?: CameraOption[];
  /** Only the household owner can delete a clip (matches the backend's
   * DELETE /api/recordings gate); everyone with camera access can still
   * play and download it, matching the playback endpoint. */
  canDelete?: boolean;
  /** Only the household owner can create an external share link (matches
   * POST /api/recordings/:id/share-links). */
  canShare?: boolean;
  /** Jumps to the Activity entry that caused this clip -- present only
   * when the clip has a `triggerMotionEventId`. */
  onOpenEvent?: (motionEventId: string) => void;
  /** A recording to scroll to and highlight right after this view mounts,
   * set by the Activity tab's "View clip" action. */
  focusRecordingId?: string | null;
  onFocusHandled?: () => void;
}) {
  const [recordings, setRecordings] = useState<RecordingSummary[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [playback, setPlayback] = useState<{ id: string; url: string } | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<RecordingSummary | null>(
    null,
  );
  const [shareTarget, setShareTarget] = useState<RecordingSummary | null>(null);
  const [search, setSearch] = useState('');
  const [bookmarkedOnly, setBookmarkedOnly] = useState(false);
  const [bookmarkNotice, setBookmarkNotice] = useState('');
  const [bookmarks, setBookmarks] = useState<string[]>(() => {
    if (!bookmarkStorageKey) return [];
    try {
      const raw = localStorage.getItem(bookmarkStorageKey);
      if (!raw || raw.length > 128_000) return [];
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed)
        ? [
            ...new Set(
              parsed.filter(
                (id): id is string =>
                  typeof id === 'string' && id.length > 0 && id.length <= 200,
              ),
            ),
          ].slice(0, 500)
        : [];
    } catch {
      return [];
    }
  });

  function saveBookmarks(next: string[]) {
    setBookmarks(next);
    setBookmarkNotice('');
    if (!bookmarkStorageKey) return;
    try {
      localStorage.setItem(bookmarkStorageKey, JSON.stringify(next));
    } catch {
      setBookmarkNotice(
        'Bookmarks work for this visit, but this browser could not save them.',
      );
    }
  }

  function toggleBookmark(id: string) {
    if (bookmarks.includes(id))
      saveBookmarks(bookmarks.filter((item) => item !== id));
    else if (bookmarks.length >= 500)
      setBookmarkNotice(
        'Remove a bookmark before adding another; this browser can save up to 500.',
      );
    else saveBookmarks([...bookmarks, id]);
  }
  const [cameraFilter, setCameraFilter] = useState('all');
  const [timeFilter, setTimeFilter] = useState('all');
  const abortRef = useRef<AbortController | null>(null);
  const urlRef = useRef<string | null>(null);
  const highlightRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  async function refresh(append = false) {
    setError('');
    if (append) setLoadingMore(true);
    try {
      const next = append ? cursor : null;
      const result = await request<{
        recordings: RecordingSummary[];
        nextCursor: string | null;
      }>(`/api/recordings${next ? `?cursor=${encodeURIComponent(next)}` : ''}`);
      if (!Array.isArray(result.recordings))
        throw new Error('Invalid recording list');
      setRecordings((current) =>
        append ? [...(current ?? []), ...result.recordings] : result.recordings,
      );
      setCursor(result.nextCursor ?? null);
    } catch {
      setError('Your clips couldn’t be loaded. Try again.');
      setRecordings((current) => current ?? []);
    } finally {
      if (append) setLoadingMore(false);
    }
  }

  useEffect(() => {
    void refresh(false);
  }, []);

  function closePlayback() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    urlRef.current = null;
    setPlayback(null);
    setBusyId(null);
  }

  async function play(recording: RecordingSummary) {
    closePlayback();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusyId(recording.id);
    setError('');
    try {
      const blob = await loadRecordingForPlayback(
        recording.id,
        controller.signal,
      );
      if (controller.signal.aborted) return;
      const url = URL.createObjectURL(blob);
      urlRef.current = url;
      setPlayback({ id: recording.id, url });
    } catch (caught) {
      if (!controller.signal.aborted)
        setError(
          friendlyError(caught, 'The clip couldn’t be played. Try again.'),
        );
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
        setBusyId(null);
      }
    }
  }

  async function downloadRecording(recording: RecordingSummary) {
    setBusyId(recording.id);
    setError('');
    try {
      const blob = await loadRecordingForPlayback(recording.id);
      const stamp = recording.createdAt.slice(0, 19).replace(/[:T]/g, '-');
      downloadBlob(
        blob,
        `beacon-${recording.cameraName.toLowerCase().replace(/\s+/g, '-')}-${stamp}.${extensionForRecordingMime(blob.type)}`,
      );
    } catch (caught) {
      setError(
        friendlyError(caught, 'The clip couldn’t be downloaded. Try again.'),
      );
    } finally {
      setBusyId(null);
    }
  }

  async function removeRecording(recording: RecordingSummary) {
    setConfirmDelete(null);
    setBusyId(recording.id);
    setError('');
    try {
      await request(`/api/recordings/${recording.id}`, { method: 'DELETE' });
      setRecordings((current) =>
        (current ?? []).filter((item) => item.id !== recording.id),
      );
      if (playback?.id === recording.id) closePlayback();
      if (bookmarks.includes(recording.id))
        saveBookmarks(bookmarks.filter((id) => id !== recording.id));
    } catch (caught) {
      setError(
        friendlyError(caught, 'The clip couldn’t be deleted. Try again.'),
      );
    } finally {
      setBusyId(null);
    }
  }

  const filtered = useMemo(() => {
    if (!recordings) return [];
    let result = recordings;
    if (bookmarkedOnly)
      result = result.filter((recording) => bookmarks.includes(recording.id));
    if (cameraFilter !== 'all')
      result = result.filter((r) => r.cameraId === cameraFilter);
    if (timeFilter !== 'all') {
      const since = Date.now() - (timeFilter === '24' ? 1 : 7) * 86_400_000;
      result = result.filter((r) => new Date(r.createdAt).getTime() >= since);
    }
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.cameraName.toLowerCase().includes(q) ||
          r.deviceName.toLowerCase().includes(q),
      );
    }
    return [...result].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }, [recordings, cameraFilter, timeFilter, search, bookmarks, bookmarkedOnly]);

  const groups = new Map<string, RecordingSummary[]>();
  for (const recording of filtered) {
    const occurred = new Date(recording.createdAt);
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    let label = occurred.toLocaleDateString(undefined, {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    if (occurred.toDateString() === today.toDateString()) label = 'Today';
    else if (occurred.toDateString() === yesterday.toDateString())
      label = 'Yesterday';
    groups.set(label, [...(groups.get(label) ?? []), recording]);
  }

  // A clip opened from Activity's "View clip" gets played automatically
  // and scrolled into view; anything else about the highlight (e.g. it no
  // longer exists) is silently a no-op rather than an error state.
  useEffect(() => {
    if (!focusRecordingId || !recordings) return;
    const target = recordings.find((r) => r.id === focusRecordingId);
    highlightRef.current?.scrollIntoView({ block: 'center' });
    if (target && target.status === 'available') void play(target);
    onFocusHandled?.();
  }, [focusRecordingId, recordings]);

  return (
    <div className="clips-container">
      <section className="page-heading">
        <div className="page-heading-inner">
          <p>
            Clips your cameras recorded, encrypted before they reach your
            connected Google Drive. Beacon's server can unlock them to play them
            back to you; Google cannot read them.
          </p>
        </div>
        <button
          className="btn secondary"
          onClick={() => void refresh(false)}
          type="button"
        >
          <Icon name="refresh" />
          <span>Refresh</span>
        </button>
      </section>

      <section className="events-controls">
        <label>
          <input
            type="checkbox"
            checked={bookmarkedOnly}
            onChange={(event) => setBookmarkedOnly(event.target.checked)}
          />{' '}
          Bookmarked only
        </label>
        <label className="events-search">
          <span className="icon-wrapper">
            <Icon name="search" />
          </span>
          <input
            type="search"
            placeholder="Search clips"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          className="events-select"
          value={cameraFilter}
          onChange={(e) => setCameraFilter(e.target.value)}
          aria-label="Filter clips by camera"
        >
          <option value="all">All devices</option>
          {cameras.map((c) => (
            <option key={c.id} value={c.id}>
              {c.deviceName}
            </option>
          ))}
        </select>
        <select
          className="events-select"
          value={timeFilter}
          onChange={(e) => setTimeFilter(e.target.value)}
          aria-label="Filter clips by time"
        >
          <option value="24">Last 24 hours</option>
          <option value="7">Last 7 days</option>
          <option value="all">All time</option>
        </select>
      </section>

      <div className="events-resultbar">
        <strong role="status">
          {filtered.length} {filtered.length === 1 ? 'clip' : 'clips'}
        </strong>
      </div>
      <p className="clips-bookmark-guidance">
        Bookmarks stay in this browser for this account and household. They do
        not preserve clips beyond retention. Filters apply to loaded clips; use
        Load more to search older clips.
      </p>
      {bookmarkNotice && <p role="status">{bookmarkNotice}</p>}

      {error && (
        <p className="recording-library-error" role="alert">
          {error}
        </p>
      )}

      {recordings === null ? (
        <p role="status">Loading recordings…</p>
      ) : filtered.length === 0 ? (
        <div className="events-empty">
          <i>
            <Icon name="film" />
          </i>
          <h3>
            {recordings.length === 0
              ? 'No recorded clips yet.'
              : 'No matching clips'}
          </h3>
          <p>
            {recordings.length === 0
              ? 'A clip appears here once a recording finishes uploading.'
              : 'No clips match these filters.'}
          </p>
        </div>
      ) : (
        Array.from(groups, ([day, entries]) => (
          <section className="events-day" key={day} aria-label={day}>
            <h2 className="events-daytitle">{day}</h2>
            <ul className="clips-feed events-feed">
              {entries.map((recording) => {
                const duration = formatDuration(recording.durationMs);
                const isHighlighted = recording.id === focusRecordingId;
                return (
                  <li
                    key={recording.id}
                    ref={isHighlighted ? highlightRef : undefined}
                    className={`clips-row${isHighlighted ? ' is-highlighted' : ''}`}
                  >
                    <div className="clips-thumb" aria-hidden="true">
                      {recording.status === 'available' &&
                      recording.hasThumbnail ? (
                        <ClipThumbnail recordingId={recording.id} />
                      ) : (
                        <Icon name="film" />
                      )}
                    </div>
                    <div className="clips-info">
                      <div className="clips-title">
                        <strong>{recording.cameraName}</strong>
                        {duration && (
                          <span className="clips-duration">{duration}</span>
                        )}
                      </div>
                      <span className="clips-meta">
                        {recording.deviceName} &middot;{' '}
                        {recordingTime(recording.createdAt)}
                      </span>
                    </div>
                    <div className="clips-actions">
                      <button
                        type="button"
                        className="btn secondary"
                        aria-pressed={bookmarks.includes(recording.id)}
                        disabled={busyId !== null}
                        onClick={() => toggleBookmark(recording.id)}
                      >
                        {bookmarks.includes(recording.id)
                          ? 'Remove bookmark'
                          : 'Bookmark clip'}
                      </button>
                      {recording.status === 'available' ? (
                        <>
                          <button
                            className="btn secondary"
                            disabled={busyId !== null}
                            onClick={() => void play(recording)}
                            type="button"
                          >
                            {busyId === recording.id &&
                            playback?.id !== recording.id
                              ? 'Opening…'
                              : 'Play clip'}
                          </button>
                          <button
                            className="btn secondary icon-btn"
                            disabled={busyId !== null}
                            onClick={() => void downloadRecording(recording)}
                            type="button"
                            aria-label="Download clip"
                            title="Download clip"
                          >
                            <Icon name="download" />
                          </button>
                          {canShare && (
                            <button
                              className="btn secondary icon-btn"
                              disabled={busyId !== null}
                              onClick={() => setShareTarget(recording)}
                              type="button"
                              aria-label="Share clip"
                              title="Share clip"
                            >
                              <Icon name="share" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              className="btn secondary icon-btn"
                              disabled={busyId !== null}
                              onClick={() => setConfirmDelete(recording)}
                              type="button"
                              aria-label="Delete clip"
                              title="Delete clip"
                            >
                              <Icon name="trash" />
                            </button>
                          )}
                        </>
                      ) : recording.status === 'failed' ? (
                        <>
                          <span className="recording-library-status">
                            {recordingStatusLabels[recording.status]}
                          </span>
                          {canDelete && (
                            <button
                              className="btn secondary"
                              disabled={busyId !== null}
                              onClick={() => void removeRecording(recording)}
                              type="button"
                            >
                              {busyId === recording.id ? 'Removing…' : 'Remove'}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="recording-library-status">
                          {recordingStatusLabels[recording.status]}
                        </span>
                      )}
                      {recording.triggerMotionEventId && onOpenEvent && (
                        <button
                          className="clips-view-event"
                          type="button"
                          onClick={() =>
                            onOpenEvent(recording.triggerMotionEventId!)
                          }
                        >
                          View event
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))
      )}

      {cursor && (
        <div className="events-bottom">
          <button
            className="btn secondary"
            onClick={() => void refresh(true)}
            disabled={loadingMore}
            type="button"
          >
            {loadingMore ? 'Loading…' : 'Load more'}
          </button>
        </div>
      )}

      {playback && (
        <div className="recording-library-player">
          <video
            aria-label="Recorded clip"
            controls
            playsInline
            src={playback.url}
          />
          <button
            className="btn secondary"
            onClick={closePlayback}
            type="button"
          >
            Close clip
          </button>
        </div>
      )}

      {confirmDelete && (
        <ConfirmDialog
          title="Delete this clip?"
          description="This permanently deletes the recorded clip from your Google Drive. This action can't be undone."
          confirmLabel="Delete clip"
          busy={busyId === confirmDelete.id}
          onConfirm={() => void removeRecording(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {shareTarget && (
        <ShareClipDialog
          recordingId={shareTarget.id}
          cameraName={shareTarget.cameraName}
          onClose={() => setShareTarget(null)}
        />
      )}
    </div>
  );
}
