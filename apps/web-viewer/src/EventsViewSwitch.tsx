import './EventsViewSwitch.css';

const views = [
  { id: 'activity', label: 'Activity' },
  { id: 'clips', label: 'Clips' },
] as const;

export type EventsView = (typeof views)[number]['id'];

/** The top-level switch between "what happened" (Activity) and "the video
 * captured because it happened" (Clips) -- a tablist so left/right arrow
 * keys move between them, matching how any other tab control behaves. */
export function EventsViewSwitch({
  value,
  onChange,
}: {
  value: EventsView;
  onChange: (next: EventsView) => void;
}) {
  return (
    <div
      className="events-view-switch"
      role="tablist"
      aria-label="Activity or clips"
    >
      {views.map((view, index) => (
        <button
          key={view.id}
          type="button"
          role="tab"
          id={`events-view-tab-${view.id}`}
          aria-selected={value === view.id}
          aria-controls={`events-view-panel-${view.id}`}
          tabIndex={value === view.id ? 0 : -1}
          className={`events-view-tab ${value === view.id ? 'on' : ''}`}
          onClick={() => onChange(view.id)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
            event.preventDefault();
            const nextIndex =
              (index + (event.key === 'ArrowRight' ? 1 : -1) + views.length) %
              views.length;
            const next = views[nextIndex]!;
            onChange(next.id);
            document.getElementById(`events-view-tab-${next.id}`)?.focus();
          }}
        >
          {view.label}
        </button>
      ))}
    </div>
  );
}
