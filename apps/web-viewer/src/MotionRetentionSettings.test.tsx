import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionRetentionSettings } from './MotionRetentionSettings';
import { SettingsAutosaveProvider } from './SettingsAutosave';

afterEach(() => vi.unstubAllGlobals());

describe('MotionRetentionSettings', () => {
  it('loads and autosaves the household metadata-retention choice', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ days: 30 }),
        ok: true,
        status: 200,
      })
      .mockResolvedValueOnce({
        json: () => Promise.resolve({ days: 7 }),
        ok: true,
        status: 200,
      });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <SettingsAutosaveProvider>
        <MotionRetentionSettings />
      </SettingsAutosaveProvider>,
    );

    expect(
      await screen.findByRole('radio', { name: /^30 days/ }),
    ).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByRole('radio', { name: '7 days' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/motion-retention',
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ days: 7 }),
        }),
      ),
    );
    expect(
      await screen.findByRole('radio', { name: '7 days' }),
    ).toHaveAttribute('aria-checked', 'true');
  });
});
