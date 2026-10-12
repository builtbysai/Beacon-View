import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cameraStatus, type CameraAvailability } from './camera-status';
import { Icon } from './Icon';
import { useRadioGroupKeyboardNav } from './useRadioGroupKeyboardNav';
import './CameraBrowser.css';

type Filter = 'all' | 'ready' | 'privacy' | 'attention';
const filters = {
  all: 'All cameras',
  ready: 'Ready to view',
  privacy: 'Privacy on',
  attention: 'Need attention',
} as const;

function filterFromUrl(): Filter {
  const value = new URLSearchParams(window.location.search).get('availability');
  return value && value in filters ? (value as Filter) : 'all';
}

interface SearchableCamera extends CameraAvailability {
  name: string;
  deviceName: string;
}

export function CameraBrowser<T extends SearchableCamera>({
  cameras,
  children,
}: {
  cameras: T[];
  children: (items: T[]) => ReactNode;
}) {
  const [query, setQuery] = useState(
    () => new URLSearchParams(window.location.search).get('query') ?? '',
  );
  const [filter, setFilter] = useState<Filter>(filterFromUrl);
  const filterPillsRef = useRef<HTMLDivElement>(null);
  useRadioGroupKeyboardNav(filterPillsRef);
  const matches = (camera: T, value: Filter) => {
    const status = cameraStatus(camera);
    return (
      value === 'all' ||
      (value === 'ready' && status.available) ||
      (value === 'privacy' && status.label === 'Privacy on') ||
      (value === 'attention' &&
        !status.available &&
        status.label !== 'Privacy on')
    );
  };
  const [visibleLimit, setVisibleLimit] = useState(9);
  const visible = cameras.filter(
    (camera) =>
      matches(camera, filter) &&
      `${camera.name} ${camera.deviceName}`
        .toLocaleLowerCase()
        .includes(query.trim().toLocaleLowerCase()),
  );

  useEffect(() => {
    const url = new URL(window.location.href);
    const trimmedQuery = query.trim();
    if (trimmedQuery) url.searchParams.set('query', trimmedQuery);
    else url.searchParams.delete('query');
    if (filter === 'all') url.searchParams.delete('availability');
    else url.searchParams.set('availability', filter);
    window.history.replaceState(
      window.history.state,
      '',
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [filter, query]);

  useEffect(() => {
    setVisibleLimit(9);
  }, [filter, query]);

  const paginatedVisible = visible.slice(0, visibleLimit);

  const resultsMessage = query.trim()
    ? `${visible.length} ${visible.length === 1 ? 'camera matches' : 'cameras match'} “${query.trim()}”.`
    : `${visible.length} of ${cameras.length} cameras shown`;

  return (
    <>
      {cameras.length > 0 && (
        <div className="camera-browser-controls">
          <label className="camera-search">
            <Icon name="search" />
            <span className="visually-hidden">Search cameras</span>
            <input
              type="search"
              placeholder="Find a camera or device"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>
          <div
            className="filter-pills"
            role="radiogroup"
            aria-label="Camera availability filters"
            ref={filterPillsRef}
          >
            {(Object.keys(filters) as Filter[]).map((value) => (
              <button
                type="button"
                key={value}
                role="radio"
                aria-checked={filter === value}
                onClick={() => setFilter(value)}
              >
                {filters[value]}
                <span aria-hidden="true">
                  {cameras.filter((camera) => matches(camera, value)).length}
                </span>
              </button>
            ))}
          </div>
          <span className="camera-results" role="status">
            {resultsMessage}
          </span>
        </div>
      )}
      {visible.length > 0 || cameras.length === 0 ? (
        <>
          {children(paginatedVisible)}
          {visible.length > 0 && (
            <div className="camera-loadarea">
              <div className="progress">
                {visible.length > paginatedVisible.length
                  ? `Showing ${paginatedVisible.length} of ${visible.length}`
                  : `All ${visible.length} cameras loaded`}
              </div>
              {visible.length > paginatedVisible.length && (
                <button
                  className="btn secondary"
                  onClick={() => setVisibleLimit((limit) => limit + 9)}
                >
                  Load more
                </button>
              )}
            </div>
          )}
        </>
      ) : (
        <div className="empty camera-no-results">
          <Icon name="search" />
          <h3>No matching cameras</h3>
          <p>Try another name or choose a different status.</p>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setQuery('');
              setFilter('all');
            }}
          >
            Clear filters
          </button>
        </div>
      )}
    </>
  );
}
