import { useEffect, useState } from 'react';
import { request } from './api';
import { useSettingsAutosave } from './SettingsAutosave';
import { SettingsRow } from './SettingsUI';

const OPTIONS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days' },
  { days: 90, label: '90 days' },
] as const;

/** 30 days is Beacon's actual default retention (see the backend's
 * motion-retention default), not a made-up recommendation. */
const RECOMMENDED_DAYS = 30;

export function MotionRetentionSettings() {
  const { run } = useSettingsAutosave();
  const [days, setDays] = useState<number | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let active = true;
    void request<{ days: number }>('/api/motion-retention')
      .then((result) => {
        if (active) setDays(result.days);
      })
      .catch(() => {
        if (active) setError(true);
      });
    return () => {
      active = false;
    };
  }, []);

  function choose(nextDays: number) {
    const previous = days;
    setDays(nextDays);
    run(async () => {
      try {
        const result = await request<{ days: number }>(
          '/api/motion-retention',
          { body: JSON.stringify({ days: nextDays }), method: 'PUT' },
        );
        setDays(result.days);
      } catch (thrown) {
        setDays(previous);
        throw thrown;
      }
    });
  }

  return (
    <SettingsRow
      title="Motion history"
      description="How long Beacon keeps motion event metadata."
    >
      {days === null ? (
        <span className="settings-card-inline-message">
          {error ? 'Could not load.' : 'Loading…'}
        </span>
      ) : (
        <div className="retention-choices" role="radiogroup" aria-label="Keep motion history for">
          {OPTIONS.map((option) => (
            <button
              key={option.days}
              type="button"
              role="radio"
              aria-checked={days === option.days}
              className={days === option.days ? 'on' : ''}
              onClick={() => choose(option.days)}
            >
              {option.label}
              {option.days === RECOMMENDED_DAYS && (
                <span className="retention-recommended">Recommended</span>
              )}
            </button>
          ))}
        </div>
      )}
    </SettingsRow>
  );
}
