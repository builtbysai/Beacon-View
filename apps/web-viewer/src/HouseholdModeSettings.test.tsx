import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  HouseholdModeBar,
  HouseholdModeSettings,
} from './HouseholdModeSettings';
import { describeWindow, type HouseholdModeState } from './household-mode';
import { SettingsAutosaveProvider } from './SettingsAutosave';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const base: HouseholdModeState = {
  canChange: true,
  changedAt: '2026-10-08T18:00:00.000Z',
  mode: 'away',
  settings: {
    muteMotionWhenHome: true,
    pauseCamerasWhenHome: false,
    resumeCamerasWhenAway: false,
    schedule: null,
  },
  source: 'manual',
};

function respond(body: unknown) {
  return { json: () => Promise.resolve(body), ok: true, status: 200 };
}

function renderSettings() {
  return render(
    <SettingsAutosaveProvider>
      <HouseholdModeSettings />
    </SettingsAutosaveProvider>,
  );
}

describe('describeWindow', () => {
  it('summarises days in plain words', () => {
    const window = { end: '23:00', start: '18:00', timeZone: 'UTC' };
    expect(describeWindow({ ...window, days: [1, 2, 3, 4, 5] })).toBe(
      'Mon to Fri, 18:00 to 23:00',
    );
    expect(describeWindow({ ...window, days: [0, 1, 2, 3, 4, 5, 6] })).toBe(
      'Every day, 18:00 to 23:00',
    );
    expect(describeWindow({ ...window, days: [0, 6] })).toBe(
      'Sun, Sat, 18:00 to 23:00',
    );
  });
});

describe('HouseholdModeSettings', () => {
  it('switches the mode and shows the new state', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(base))
      .mockResolvedValueOnce(respond({ ...base, mode: 'home' }));
    vi.stubGlobal('fetch', fetchMock);
    renderSettings();

    expect(await screen.findByRole('radio', { name: 'Away' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    fireEvent.click(screen.getByRole('radio', { name: 'Home' }));
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/household/mode',
        expect.objectContaining({
          body: JSON.stringify({ mode: 'home' }),
          method: 'PUT',
        }),
      ),
    );
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: 'Home' })).toHaveAttribute(
        'aria-checked',
        'true',
      ),
    );
  });

  it('only offers to resume cameras once pausing is on, and turns resume off with it', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        respond({
          ...base,
          settings: {
            ...base.settings,
            pauseCamerasWhenHome: true,
            resumeCamerasWhenAway: true,
          },
        }),
      )
      .mockResolvedValueOnce(respond(base));
    vi.stubGlobal('fetch', fetchMock);
    renderSettings();

    const resume = await screen.findByRole('switch', {
      name: 'Resume those cameras when Away',
    });
    expect(resume).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(
      screen.getByRole('switch', { name: 'Pause Android cameras while Home' }),
    );
    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/household/mode-settings',
        expect.objectContaining({
          body: JSON.stringify({
            muteMotionWhenHome: true,
            pauseCamerasWhenHome: false,
            resumeCamerasWhenAway: false,
            schedule: null,
          }),
          method: 'PUT',
        }),
      ),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole('switch', {
          name: 'Resume those cameras when Away',
        }),
      ).toBeNull(),
    );
  });

  it('saves a weekly schedule only when asked, and not with no days chosen', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(respond(base))
      .mockImplementation((_url: string, init: { body: string }) =>
        Promise.resolve(
          respond({ ...base, settings: JSON.parse(init.body) as never }),
        ),
      );
    vi.stubGlobal('fetch', fetchMock);
    renderSettings();

    fireEvent.click(
      await screen.findByRole('switch', { name: 'Follow a weekly schedule' }),
    );
    // Turning it on does not save anything yet.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const save = screen.getByRole('button', { name: 'Save schedule' });

    fireEvent.click(screen.getByRole('button', { name: 'Saturday' }));
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const sent = JSON.parse(
      (fetchMock.mock.calls[1]![1] as { body: string }).body,
    ) as { schedule: { windows: { days: number[] }[] } };
    expect(sent.schedule.windows[0]!.days).toEqual([1, 2, 3, 4, 5, 6]);

    // Saved: nothing left to save.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Save schedule' }),
      ).toBeDisabled(),
    );
    // Clearing every day blocks saving.
    for (const day of [
      'Monday',
      'Tuesday',
      'Wednesday',
      'Thursday',
      'Friday',
      'Saturday',
    ])
      fireEvent.click(screen.getByRole('button', { name: day }));
    expect(
      screen.getByRole('button', { name: 'Save schedule' }),
    ).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent(/at least one day/i);
  });

  it('lets people without admin access read the mode but not change it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond({ ...base, canChange: false })),
    );
    renderSettings();
    expect(await screen.findByRole('radio', { name: 'Home' })).toBeDisabled();
  });
});

describe('HouseholdModeBar', () => {
  it('stays out of the way for people who cannot change the mode', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(respond({ ...base, canChange: false }));
    vi.stubGlobal('fetch', fetchMock);
    const { container } = render(<HouseholdModeBar />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('shows what Home does to alerts', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(respond({ ...base, mode: 'home' })),
    );
    render(<HouseholdModeBar />);
    expect(
      await screen.findByText('Motion alerts are muted.'),
    ).toBeInTheDocument();
  });
});
