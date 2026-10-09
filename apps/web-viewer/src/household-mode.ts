import { useCallback, useEffect, useState } from 'react';

import { request } from './api';

/** Home and Away modes (ADR 0094). */
export type HouseholdModeName = 'home' | 'away';

export interface ScheduleWindow {
  /** 0 is Sunday. */
  days: number[];
  start: string;
  end: string;
  timeZone: string;
}

export interface ModeSettings {
  muteMotionWhenHome: boolean;
  pauseCamerasWhenHome: boolean;
  resumeCamerasWhenAway: boolean;
  schedule: { windows: ScheduleWindow[] } | null;
}

export interface HouseholdModeState {
  mode: HouseholdModeName;
  source: 'manual' | 'schedule';
  changedAt: string;
  settings: ModeSettings;
  canChange: boolean;
}

export const MODE_EVENT = 'beacon:household-mode';
export const MAX_SCHEDULE_WINDOWS = 8;
export const DAY_LABELS = [
  { label: 'Sun', name: 'Sunday' },
  { label: 'Mon', name: 'Monday' },
  { label: 'Tue', name: 'Tuesday' },
  { label: 'Wed', name: 'Wednesday' },
  { label: 'Thu', name: 'Thursday' },
  { label: 'Fri', name: 'Friday' },
  { label: 'Sat', name: 'Saturday' },
] as const;

/** A new window: weekday evenings in this device's time zone. */
export function defaultWindow(): ScheduleWindow {
  let timeZone = 'UTC';
  try {
    timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    // Keep UTC.
  }
  return { days: [1, 2, 3, 4, 5], start: '18:00', end: '23:00', timeZone };
}

/** "Mon to Fri, 18:00 to 23:00" in plain words. */
export function describeWindow(window: ScheduleWindow): string {
  const days = [...window.days].sort((a, b) => a - b);
  const consecutive = days.every(
    (day, index) => index === 0 || day === days[index - 1]! + 1,
  );
  const names = days.map((day) => DAY_LABELS[day]!.label);
  const text =
    days.length === 7
      ? 'Every day'
      : consecutive && days.length > 2
        ? `${names[0]} to ${names[names.length - 1]}`
        : names.join(', ');
  return `${text}, ${window.start} to ${window.end}`;
}

function isModeState(value: unknown): value is HouseholdModeState {
  const candidate = value as Partial<HouseholdModeState> | null;
  return (
    !!candidate &&
    (candidate.mode === 'home' || candidate.mode === 'away') &&
    typeof candidate.changedAt === 'string' &&
    !!candidate.settings
  );
}

/** Tells every mounted mode control that the mode changed. */
export function announceModeChange(): void {
  window.dispatchEvent(new Event(MODE_EVENT));
}

/**
 * The household's mode, kept fresh: reloaded on the household event the
 * server sends when anyone (or the schedule) changes it.
 */
export function useHouseholdMode(): {
  state: HouseholdModeState | null;
  failed: boolean;
  setMode: (mode: HouseholdModeName) => Promise<void>;
  saveSettings: (settings: ModeSettings) => Promise<void>;
} {
  const [state, setState] = useState<HouseholdModeState | null>(null);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await request<HouseholdModeState>('/api/household/mode');
      if (!isModeState(next)) throw new Error('Unexpected mode response');
      setState(next);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    const reload = () => void load();
    reload();
    window.addEventListener(MODE_EVENT, reload);
    return () => window.removeEventListener(MODE_EVENT, reload);
  }, [load]);

  const setMode = useCallback(async (mode: HouseholdModeName) => {
    const next = await request<HouseholdModeState>('/api/household/mode', {
      body: JSON.stringify({ mode }),
      method: 'PUT',
    });
    setState(next);
  }, []);

  const saveSettings = useCallback(async (settings: ModeSettings) => {
    const next = await request<HouseholdModeState>(
      '/api/household/mode-settings',
      { body: JSON.stringify(settings), method: 'PUT' },
    );
    setState(next);
  }, []);

  return { failed, saveSettings, setMode, state };
}
