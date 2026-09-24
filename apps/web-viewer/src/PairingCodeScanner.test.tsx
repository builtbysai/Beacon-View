import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { act } from 'react';
import { afterEach, expect, it, vi } from 'vitest';

import { PairingCodeScanner } from './PairingCodeScanner';

const scanner = vi.hoisted(() => ({
  callback: null as
    | null
    | ((
        result: { getText(): string },
        error: null,
        controls: { stop(): void },
      ) => void),
  decode: vi.fn(),
  stop: vi.fn(),
}));

vi.mock('@zxing/browser', () => ({
  BrowserQRCodeReader: class {
    decodeFromVideoDevice = scanner.decode;
  },
}));

afterEach(() => {
  cleanup();
  scanner.callback = null;
  scanner.decode.mockReset();
  scanner.stop.mockReset();
});

it('accepts a Beacon QR and stops scanning when it is closed', async () => {
  scanner.decode.mockImplementation((_device, _video, callback) => {
    scanner.callback = callback as NonNullable<typeof scanner.callback>;
    return Promise.resolve({ stop: scanner.stop });
  });
  const onCode = vi.fn();
  const view = render(
    <PairingCodeScanner onCode={onCode} onClose={() => undefined} />,
  );
  await waitFor(() => expect(scanner.callback).not.toBeNull());
  act(() => {
    scanner.callback?.(
      { getText: () => 'https://other.example/pair?code=ABCDEFGH23' },
      null,
      { stop: scanner.stop },
    );
  });
  expect(onCode).not.toHaveBeenCalled();
  expect(screen.getByRole('status')).toHaveTextContent('not a Beacon');
  act(() => {
    scanner.callback?.({ getText: () => 'ABCDEFGH23' }, null, {
      stop: scanner.stop,
    });
  });
  expect(onCode).toHaveBeenCalledWith('ABCDEFGH23');
  view.unmount();
  expect(scanner.stop).toHaveBeenCalled();
});
