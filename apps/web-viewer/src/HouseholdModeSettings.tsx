import { useEffect, useState } from 'react';

import {
  DAY_LABELS,
  MAX_SCHEDULE_WINDOWS,
  defaultWindow,
  describeWindow,
  useHouseholdMode,
  type HouseholdModeName,
  type HouseholdModeState,
  type ModeSettings,
  type ScheduleWindow,
} from './household-mode';
import { useSettingsAutosave } from './SettingsAutosave';
import { SettingsCard, SettingsRow } from './SettingsUI';
import './HouseholdMode.css';

/** The Home / Away choice, shared by Settings and the cameras page. */
export function ModeChoice({
  disabled,
  mode,
  onChoose,
}: {
  disabled?: boolean;
  mode: HouseholdModeName;
  onChoose: (mode: HouseholdModeName) => void;
}) {
  return (
    <div
      className="retention-choices mode-choice"
      role="radiogroup"
      aria-label="Household mode"
    >
      {(['home', 'away'] as const).map((choice) => (
        <button
          aria-checked={mode === choice}
          disabled={disabled}
          key={choice}
          onClick={() => mode !== choice && onChoose(choice)}
          role="radio"
          type="button"
        >
          {choice === 'home' ? 'Home' : 'Away'}
        </button>
      ))}
    </div>
  );
}

function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      aria-checked={checked}
      aria-label={label}
      className={`camera-settings-switch ${checked ? 'is-on' : ''}`}
      onClick={() => onChange(!checked)}
      role="switch"
      type="button"
    >
      <span />
    </button>
  );
}

/** Who set the mode, and when, in plain words. */
export function modeCaption(state: HouseholdModeState): string {
  if (state.changedAt.startsWith('1970')) return 'Not changed yet.';
  const when = new Date(state.changedAt).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  return state.source === 'schedule'
    ? `Set by your schedule, ${when}.`
    : `Changed ${when}.`;
}

function ScheduleEditor({
  onSave,
  settings,
}: {
  onSave: (schedule: ModeSettings['schedule']) => void;
  settings: ModeSettings;
}) {
  const saved = settings.schedule?.windows ?? null;
  const [draft, setDraft] = useState<ScheduleWindow[] | null>(saved);
  useEffect(() => setDraft(saved), [saved]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const valid =
    draft === null ||
    (draft.length > 0 &&
      draft.every(
        (window) => window.days.length > 0 && window.start !== window.end,
      ));
  const change = (index: number, patch: Partial<ScheduleWindow>) =>
    setDraft((windows) =>
      windows!.map((window, at) =>
        at === index ? { ...window, ...patch } : window,
      ),
    );

  return (
    <>
      <SettingsRow
        title="Follow a weekly schedule"
        description="Be Home at set times and Away the rest of the time. Changing the mode yourself stands until the schedule next changes."
      >
        <Switch
          checked={draft !== null}
          label="Follow a weekly schedule"
          onChange={(on) => {
            if (on) setDraft(saved ?? [defaultWindow()]);
            else {
              setDraft(null);
              if (saved) onSave(null);
            }
          }}
        />
      </SettingsRow>
      {draft && (
        <div className="mode-schedule">
          <p className="mode-schedule-summary">
            Home: {draft.map(describeWindow).join(' · ')}
          </p>
          {draft.map((window, index) => (
            <fieldset className="mode-window" key={index}>
              <legend>Home window {index + 1}</legend>
              <div className="mode-days" role="group" aria-label="Days">
                {DAY_LABELS.map((day, dayIndex) => {
                  const on = window.days.includes(dayIndex);
                  return (
                    <button
                      aria-label={day.name}
                      aria-pressed={on}
                      key={day.name}
                      onClick={() =>
                        change(index, {
                          days: on
                            ? window.days.filter((item) => item !== dayIndex)
                            : [...window.days, dayIndex].sort((a, b) => a - b),
                        })
                      }
                      type="button"
                    >
                      {day.label}
                    </button>
                  );
                })}
              </div>
              <div className="mode-times">
                <label>
                  From
                  <input
                    onChange={(event) =>
                      change(index, { start: event.target.value })
                    }
                    type="time"
                    value={window.start}
                  />
                </label>
                <label>
                  Until
                  <input
                    onChange={(event) =>
                      change(index, { end: event.target.value })
                    }
                    type="time"
                    value={window.end}
                  />
                </label>
                <span className="mode-zone">{window.timeZone}</span>
                {draft.length > 1 && (
                  <button
                    className="secondary"
                    onClick={() =>
                      setDraft(draft.filter((_, at) => at !== index))
                    }
                    type="button"
                  >
                    Remove
                  </button>
                )}
              </div>
            </fieldset>
          ))}
          <div className="mode-schedule-actions">
            {draft.length < MAX_SCHEDULE_WINDOWS && (
              <button
                className="secondary"
                onClick={() => setDraft([...draft, defaultWindow()])}
                type="button"
              >
                Add another window
              </button>
            )}
            <button
              className="btn primary"
              disabled={!dirty || !valid}
              onClick={() => onSave({ windows: draft })}
              type="button"
            >
              Save schedule
            </button>
          </div>
          {!valid && (
            <p className="mode-hint" role="alert">
              Pick at least one day, and different start and end times.
            </p>
          )}
        </div>
      )}
    </>
  );
}

/** Settings → Home & Away (ADR 0094). */
export function HouseholdModeSettings() {
  const { run } = useSettingsAutosave();
  const { failed, saveSettings, setMode, state } = useHouseholdMode();

  if (!state)
    return (
      <SettingsCard aria-label="Home and Away">
        <p className="settings-card-inline-message">
          {failed ? 'Could not load.' : 'Loading…'}
        </p>
      </SettingsCard>
    );

  const update = (patch: Partial<ModeSettings>) =>
    run(() => saveSettings({ ...state.settings, ...patch }));

  return (
    <SettingsCard aria-label="Home and Away">
      <SettingsRow
        title="Right now"
        description={`${state.mode === 'home' ? 'Someone is home.' : 'Nobody is home.'} ${modeCaption(state)}`}
      >
        <ModeChoice
          disabled={!state.canChange}
          mode={state.mode}
          onChoose={(mode) => run(() => setMode(mode))}
        />
      </SettingsRow>
      <SettingsRow
        title="Mute motion alerts while Home"
        description="You still get camera offline and camera problem alerts. Motion is still recorded in your history."
      >
        <Switch
          checked={state.settings.muteMotionWhenHome}
          label="Mute motion alerts while Home"
          onChange={(muteMotionWhenHome) => update({ muteMotionWhenHome })}
        />
      </SettingsRow>
      <SettingsRow
        title="Pause Android cameras while Home"
        description="Turns on privacy mode for your Android cameras so they stop capturing."
      >
        <Switch
          checked={state.settings.pauseCamerasWhenHome}
          label="Pause Android cameras while Home"
          onChange={(pauseCamerasWhenHome) =>
            update({
              pauseCamerasWhenHome,
              ...(pauseCamerasWhenHome ? {} : { resumeCamerasWhenAway: false }),
            })
          }
        />
      </SettingsRow>
      {state.settings.pauseCamerasWhenHome && (
        <SettingsRow
          title="Resume those cameras when Away"
          description="Only cameras that Home paused start again, and the camera shows its capture notice. Off, you turn them back on yourself."
        >
          <Switch
            checked={state.settings.resumeCamerasWhenAway}
            label="Resume those cameras when Away"
            onChange={(resumeCamerasWhenAway) =>
              update({ resumeCamerasWhenAway })
            }
          />
        </SettingsRow>
      )}
      <ScheduleEditor
        onSave={(schedule) => update({ schedule })}
        settings={state.settings}
      />
    </SettingsCard>
  );
}

/** A compact Home / Away switch for the cameras page. */
export function HouseholdModeBar() {
  const { setMode, state } = useHouseholdMode();
  const [error, setError] = useState('');
  if (!state?.canChange) return null;
  return (
    <div className="mode-bar">
      <div>
        <strong>{state.mode === 'home' ? 'Home' : 'Away'}</strong>
        <span>
          {state.mode === 'home'
            ? state.settings.muteMotionWhenHome
              ? 'Motion alerts are muted.'
              : 'Motion alerts stay on.'
            : 'Watching normally.'}
        </span>
      </div>
      <ModeChoice
        mode={state.mode}
        onChoose={(mode) => {
          setError('');
          setMode(mode).catch(() =>
            setError('Couldn’t change the mode. Try again.'),
          );
        }}
      />
      {error && <p role="alert">{error}</p>}
    </div>
  );
}
