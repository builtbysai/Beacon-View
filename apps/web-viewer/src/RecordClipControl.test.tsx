import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DRIVE_READY, type DriveRecording } from './drive-recording';
import { DriveReconnectNotice, RecordClipControl } from './RecordClipControl';
import type { ClipRecorderState, useClipRecorder } from './useClipRecorder';

type Clip = ReturnType<typeof useClipRecorder>;

afterEach(cleanup);

function clip(state: Partial<ClipRecorderState>, pending = false): Clip {
  return {
    abort: vi.fn(),
    hasPendingUpload: pending,
    reset: vi.fn(),
    retry: vi.fn(),
    start: vi.fn(),
    state: { elapsedMs: 0, error: '', status: 'idle', ...state },
    stop: vi.fn(),
    supported: true,
  };
}

function drive(overrides: Partial<DriveRecording>): DriveRecording {
  return { ...DRIVE_READY, report: vi.fn(), ...overrides };
}

const expiredUpload = {
  error: 'Google Drive disconnected.',
  errorCode: 'drive_reconnect_required',
  status: 'failed' as const,
};

describe('recording when Google Drive needs attention', () => {
  it('keeps a recorded clip and uploads it by itself once Drive is reconnected', () => {
    const recorded = clip(expiredUpload, true);
    const connect = vi.fn();
    const { rerender } = render(
      <DriveReconnectNotice
        className="on-video"
        clip={recorded}
        drive={drive({ connect, state: 'expired' })}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      /clip is kept on this device/i,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Reconnect Google Drive' }),
    );
    expect(connect).toHaveBeenCalledTimes(1);
    expect(recorded.retry).not.toHaveBeenCalled();

    rerender(
      <DriveReconnectNotice
        className="on-video"
        clip={recorded}
        drive={drive({ connect, state: 'ready' })}
      />,
    );
    expect(recorded.retry).toHaveBeenCalledTimes(1);
  });

  it('shows progress while the Google window is open', () => {
    render(
      <DriveReconnectNotice
        className="on-video"
        clip={clip(expiredUpload, true)}
        drive={drive({ connecting: true, state: 'expired' })}
      />,
    );
    expect(
      screen.getByRole('button', { name: 'Waiting for Google Drive…' }),
    ).toBeDisabled();
    expect(screen.getByText(/finish in the google window/i)).toBeVisible();
  });

  it('lets the owner discard a held clip', () => {
    const recorded = clip(expiredUpload, true);
    render(
      <DriveReconnectNotice
        className="on-video"
        clip={recorded}
        drive={drive({ state: 'expired' })}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Discard clip' }));
    expect(recorded.reset).toHaveBeenCalledTimes(1);
  });

  it('tells the Drive tracker so the record button switches to Reconnect', () => {
    const report = vi.fn();
    render(
      <DriveReconnectNotice
        className="on-video"
        clip={clip(expiredUpload)}
        drive={drive({ report, state: 'ready' })}
      />,
    );
    expect(report).toHaveBeenCalledWith('drive_reconnect_required');
  });

  it('stays out of the way for failures Drive did not cause', () => {
    render(
      <DriveReconnectNotice
        className="on-video"
        clip={clip({ error: 'Camera is offline', status: 'failed' })}
        drive={drive({})}
      />,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('offers a held clip’s upload retry, and a fresh recording otherwise', () => {
    const held = clip({ error: 'Network', status: 'failed' }, true);
    const { rerender } = render(
      <RecordClipControl
        className="video-control"
        clip={held}
        drive={drive({})}
        onStart={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Retry encrypted recording upload' }),
    );
    expect(held.retry).toHaveBeenCalledTimes(1);

    const lost = clip({ error: 'Stream ended', status: 'failed' });
    const onStart = vi.fn();
    rerender(
      <RecordClipControl
        className="video-control"
        clip={lost}
        drive={drive({})}
        onStart={onStart}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: 'Record a short clip' }),
    );
    expect(lost.reset).toHaveBeenCalledTimes(1);
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it('keeps a stop button during a recording even if Drive just expired', () => {
    render(
      <RecordClipControl
        className="video-control"
        clip={clip({ status: 'recording' })}
        drive={drive({ state: 'expired' })}
        onStart={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Recording,/ })).toBeEnabled();
  });

  it('hides recording entirely when this server has no Drive', () => {
    render(
      <RecordClipControl
        className="video-control"
        clip={clip({})}
        drive={drive({ state: 'unavailable' })}
        onStart={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
