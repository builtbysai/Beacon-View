import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MotionRetentionSettings } from './MotionRetentionSettings';

afterEach(() => vi.unstubAllGlobals());

describe('MotionRetentionSettings', () => {
  it('loads and saves the household metadata-retention choice', async () => {
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
    render(<MotionRetentionSettings />);

    expect(await screen.findByLabelText('Keep motion history for')).toHaveValue(
      '30',
    );
    expect(screen.queryByText('✓ Saved')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Keep motion history for'), {
      target: { value: '7' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenLastCalledWith(
        '/api/motion-retention',
        expect.objectContaining({ method: 'PUT' }),
      ),
    );
    expect(await screen.findByText('✓ Saved')).toBeVisible();
  });
});
