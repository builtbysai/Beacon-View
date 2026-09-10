import { useEffect, useRef, useState } from 'react';
import { request } from './api';

const OPTIONS = [
  { days: 1, label: '1 day' },
  { days: 7, label: '7 days' },
  { days: 30, label: '30 days (recommended)' },
  { days: 90, label: '90 days' },
];

export function MotionRetentionSettings() {
  const [days, setDays] = useState<number | null>(null);
  const [savedDays, setSavedDays] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const savedTimer = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void request<{ days: number }>('/api/motion-retention')
      .then((result) => {
        if (!active) return;
        setDays(result.days);
        setSavedDays(result.days);
      })
      .catch(() => {
        if (active) setError('Motion retention could not be loaded.');
      });
    return () => {
      active = false;
    };
  }, []);

  async function save() {
    if (!days || saving) return;
    setSaving(true);
    setError('');
    setJustSaved(false);
    try {
      const result = await request<{ days: number }>('/api/motion-retention', {
        body: JSON.stringify({ days }),
        method: 'PUT',
      });
      setDays(result.days);
      setSavedDays(result.days);
      setJustSaved(true);
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setJustSaved(false), 3_000);
    } catch {
      setError('Motion retention could not be saved. Try again.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="motion-retention-title">
      <h4 id="motion-retention-title">Motion history</h4>
      <p>
        Beacon stores motion time, camera name, and motion intensity, not
        recordings, images, or audio. Expired history is deleted automatically.
      </p>
      {error && <p role="alert">{error}</p>}
      {days === null ? (
        !error && <p role="status">Loading motion history settings…</p>
      ) : (
        <form
          aria-label="Motion history retention"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label>
            Keep motion history for
            <select
              aria-label="Keep motion history for"
              disabled={saving}
              value={days}
              onChange={(event) => {
                setJustSaved(false);
                setDays(Number(event.target.value));
              }}
            >
              {OPTIONS.map((option) => (
                <option key={option.days} value={option.days}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={saving || days === savedDays}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {justSaved && (
            <p className="setting-saved" role="status">
              ✓ Saved
            </p>
          )}
        </form>
      )}
    </section>
  );
}
