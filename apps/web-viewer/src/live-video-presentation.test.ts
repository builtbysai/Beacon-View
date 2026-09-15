import { describe, expect, it } from 'vitest';
import { liveOverlay, talkStatusText } from './live-video-presentation';

describe('live video presentation', () => {
  it('hides the overlay only after the first connected frame', () => {
    expect(liveOverlay('connected', true, false, 0)).toBeNull();
    expect(liveOverlay('connected', false, false, 0)).toEqual({
      title: 'Starting secure video',
      detail: 'The secure connection is ready. Waiting for the first frame.',
    });
  });

  it('prioritizes a source switch and includes retry progress', () => {
    expect(liveOverlay('connected', true, true, 0)?.title).toBe(
      'Switching camera',
    );
    expect(liveOverlay('reconnecting', false, false, 3)?.detail).toBe(
      'Beacon is retrying · attempt 3.',
    );
  });

  it('maps active talk states to concise status copy', () => {
    expect(talkStatusText('permission')).toBe(
      'Allow microphone access to talk.',
    );
    expect(talkStatusText('speaking')).toBe('Speaking · microphone on');
    expect(talkStatusText('unavailable')).toBe('Talk unavailable.');
  });
});
