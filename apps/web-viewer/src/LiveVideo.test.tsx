import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { LiveVideo } from './LiveVideo';

class FakeWebSocket {
  static readonly OPEN = 1;
  readonly OPEN = 1;
  readyState = 0;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;

  close() {}
  send() {}
}

afterEach(() => vi.unstubAllGlobals());

describe('LiveVideo', () => {
  it('shows a safe connecting state with no audio or recording controls', () => {
    vi.stubGlobal('WebSocket', FakeWebSocket);
    render(
      <LiveVideo
        camera={{ id: 'camera-id', name: 'Kitchen camera' }}
        onBack={() => undefined}
      />,
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Connection: connecting',
    );
    expect(screen.getByText('Kitchen camera')).toBeVisible();
    expect(screen.queryByText(/record/i)).not.toBeNull();
    expect(screen.queryByRole('button', { name: /record/i })).toBeNull();
  });
});
