import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

import { RecordingLibrary } from './RecordingLibrary';

const playback = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock('./recording-playback', () => ({
  loadRecordingForPlayback: playback.load,
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(URL, 'createObjectURL');
  Reflect.deleteProperty(URL, 'revokeObjectURL');
  playback.load.mockReset();
});

it('opens and releases a decrypted recording from Activity', async () => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          recordings: [
            {
              id: 'clip-1',
              cameraName: 'Front door',
              deviceName: 'Spare phone',
              status: 'available',
              createdAt: '2026-09-24T12:00:00Z',
            },
          ],
        }),
        { status: 200 },
      ),
    ),
  );
  const createUrl = vi.fn().mockReturnValue('blob:beacon-clip');
  const revokeUrl = vi.fn();
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    value: createUrl,
  });
  Object.defineProperty(URL, 'revokeObjectURL', {
    configurable: true,
    value: revokeUrl,
  });
  playback.load.mockResolvedValue(new Blob(['private clip']));

  render(<RecordingLibrary />);
  fireEvent.click(await screen.findByRole('button', { name: 'Play clip' }));
  expect(await screen.findByLabelText('Recorded clip')).toHaveAttribute(
    'src',
    'blob:beacon-clip',
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close clip' }));
  expect(revokeUrl).toHaveBeenCalledWith('blob:beacon-clip');
});
