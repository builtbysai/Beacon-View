import { describe, expect, it, vi } from 'vitest';

import { HOLD_MS, PushToTalk } from './push-to-talk';
import { shortcutFor } from './live-shortcuts';
import { snapshotFileName } from './snapshot';
import { clampZoom, IDENTITY, MAX_SCALE, panBy, zoomAt } from './video-zoom';

const frame = { height: 400, width: 800 };

describe('zoom and pan', () => {
  it('never zooms out past the picture or in past the limit', () => {
    expect(clampZoom({ scale: 0.4, x: 50, y: 50 }, frame)).toEqual(IDENTITY);
    expect(clampZoom({ scale: 99, x: 0, y: 0 }, frame).scale).toBe(MAX_SCALE);
  });

  it('keeps the point under the cursor in place while zooming', () => {
    const point = { x: 600, y: 100 };
    const zoomed = zoomAt(IDENTITY, 2, point, frame);
    // The picture coordinate under the pointer is unchanged.
    expect((point.x - zoomed.x) / zoomed.scale).toBeCloseTo(600);
    expect((point.y - zoomed.y) / zoomed.scale).toBeCloseTo(100);
  });

  it('never leaves empty margins when panning', () => {
    const zoomed = zoomAt(IDENTITY, 2, { x: 0, y: 0 }, frame);
    const dragged = panBy(zoomed, 500, 500, frame);
    expect(dragged.x).toBe(0);
    expect(dragged.y).toBe(0);
    const far = panBy(zoomed, -5000, -5000, frame);
    expect(far.x).toBe(frame.width - 2 * frame.width);
    expect(far.y).toBe(frame.height - 2 * frame.height);
  });

  it('does not pan an unzoomed picture', () => {
    expect(panBy(IDENTITY, 40, 40, frame)).toBe(IDENTITY);
  });

  it('returns to the identity when zoomed all the way out', () => {
    const zoomed = zoomAt(IDENTITY, 3, { x: 200, y: 100 }, frame);
    expect(zoomAt(zoomed, 1 / 3, { x: 200, y: 100 }, frame)).toEqual(IDENTITY);
  });
});

describe('hold-to-talk', () => {
  function setup(start = 0) {
    let now = start;
    let talking = false;
    const begin = vi.fn(() => {
      talking = true;
    });
    const end = vi.fn(() => {
      talking = false;
    });
    const ptt = new PushToTalk(
      () => talking,
      begin,
      end,
      () => now,
    );
    return { advance: (ms: number) => (now += ms), begin, end, ptt };
  }

  it('a tap leaves talking on, and a second tap ends it', () => {
    const { advance, begin, end, ptt } = setup();
    ptt.press();
    advance(120);
    ptt.release();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).not.toHaveBeenCalled();
    advance(2_000);
    ptt.press();
    ptt.release();
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('a hold talks only while held', () => {
    const { advance, begin, end, ptt } = setup();
    ptt.press();
    advance(HOLD_MS + 50);
    ptt.release();
    expect(begin).toHaveBeenCalledTimes(1);
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('ignores a repeated press before the release', () => {
    const { begin, ptt } = setup();
    ptt.press();
    ptt.press();
    expect(begin).toHaveBeenCalledTimes(1);
  });
});

describe('shortcuts', () => {
  const key = (value: string, extra = {}) => ({
    altKey: false,
    ctrlKey: false,
    key: value,
    metaKey: false,
    ...extra,
  });

  it('maps keys to actions, in either case', () => {
    expect(shortcutFor(key('f'))).toBe('fullscreen');
    expect(shortcutFor(key('F'))).toBe('fullscreen');
    expect(shortcutFor(key('p'))).toBe('pictureInPicture');
    expect(shortcutFor(key('m'))).toBe('listen');
    expect(shortcutFor(key('t'))).toBe('talk');
    expect(shortcutFor(key('s'))).toBe('snapshot');
    expect(shortcutFor(key('='))).toBe('zoomIn');
    expect(shortcutFor(key('-'))).toBe('zoomOut');
    expect(shortcutFor(key('0'))).toBe('zoomReset');
    expect(shortcutFor(key('ArrowLeft'))).toBe('previousCamera');
    expect(shortcutFor(key('ArrowRight'))).toBe('nextCamera');
    expect(shortcutFor(key('?'))).toBe('help');
  });

  it('leaves browser and system combinations alone', () => {
    expect(shortcutFor(key('s', { ctrlKey: true }))).toBeNull();
    expect(shortcutFor(key('f', { metaKey: true }))).toBeNull();
    expect(shortcutFor(key('p', { altKey: true }))).toBeNull();
    expect(shortcutFor(key('x'))).toBeNull();
  });
});

describe('snapshot file names', () => {
  it('names the file after the camera and the time', () => {
    expect(
      snapshotFileName('Front Porch', new Date(2026, 9, 8, 12, 30, 5)),
    ).toBe('Beacon-Front-Porch-2026-10-08-12-30-05.png');
  });

  it('is safe for every file system', () => {
    expect(snapshotFileName('../a/b:c*?', new Date(2026, 0, 2, 3, 4, 5))).toBe(
      'Beacon-a-b-c-2026-01-02-03-04-05.png',
    );
    expect(snapshotFileName('   ', new Date(2026, 0, 2, 3, 4, 5))).toMatch(
      /^Beacon-Camera-/u,
    );
  });
});
