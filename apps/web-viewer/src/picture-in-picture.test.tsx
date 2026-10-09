import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  pictureInPictureSupported,
  usePictureInPicture,
} from './picture-in-picture';

function floatingVideo() {
  const video = document.createElement('video');
  let floating = false;
  Object.defineProperty(document, 'pictureInPictureEnabled', {
    configurable: true,
    value: true,
  });
  Object.defineProperty(document, 'pictureInPictureElement', {
    configurable: true,
    get: () => (floating ? video : null),
  });
  const exitPictureInPicture = vi.fn(() => {
    floating = false;
    video.dispatchEvent(new Event('leavepictureinpicture'));
    return Promise.resolve();
  });
  Object.defineProperty(document, 'exitPictureInPicture', {
    configurable: true,
    value: exitPictureInPicture,
  });
  video.requestPictureInPicture = vi.fn(() => {
    floating = true;
    video.dispatchEvent(new Event('enterpictureinpicture'));
    return Promise.resolve({} as PictureInPictureWindow);
  });
  return { exitPictureInPicture, video };
}

afterEach(() => {
  delete (document as { pictureInPictureEnabled?: boolean })
    .pictureInPictureEnabled;
  delete (document as { pictureInPictureElement?: unknown })
    .pictureInPictureElement;
  vi.unstubAllGlobals();
});

describe('picture-in-picture', () => {
  it('clears floating state when viewing is disabled by a sleep timer', async () => {
    const { video, exitPictureInPicture } = floatingVideo();
    const ref = { current: video };
    const { result, rerender, unmount } = renderHook(
      ({ enabled }) =>
        usePictureInPicture(ref, { auto: false, enabled, title: 'Porch' }),
      { initialProps: { enabled: true } },
    );
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.active).toBe(true);
    await act(async () => {
      rerender({ enabled: false });
      await Promise.resolve();
    });
    expect(exitPictureInPicture).toHaveBeenCalled();
    expect(result.current.active).toBe(false);
    unmount();
  });
  it('floats the live video and brings it back', async () => {
    const { video } = floatingVideo();
    const ref = { current: video };
    const { result } = renderHook(() =>
      usePictureInPicture(ref, { auto: false, enabled: true, title: 'Porch' }),
    );
    expect(result.current.supported).toBe(true);
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.active).toBe(true);
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.active).toBe(false);
  });

  it('closes the floating window when the live view closes', async () => {
    const { exitPictureInPicture, video } = floatingVideo();
    const ref = { current: video };
    const { result, unmount } = renderHook(() =>
      usePictureInPicture(ref, { auto: false, enabled: true, title: 'Porch' }),
    );
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    unmount();
    expect(exitPictureInPicture).toHaveBeenCalled();
  });

  it('floats on its own when you leave, only for the full live view', () => {
    const { video } = floatingVideo();
    const handlers = new Map<string, unknown>();
    vi.stubGlobal('navigator', {
      mediaSession: {
        metadata: null,
        setActionHandler: (action: string, handler: unknown) =>
          handlers.set(action, handler),
      },
    });
    vi.stubGlobal(
      'MediaMetadata',
      class {
        constructor(readonly init: object) {}
      },
    );
    const ref = { current: video };
    const { rerender, unmount } = renderHook(
      ({ auto }) =>
        usePictureInPicture(ref, { auto, enabled: true, title: 'Porch' }),
      { initialProps: { auto: true } },
    );
    expect(video.hasAttribute('autopictureinpicture')).toBe(true);
    expect(handlers.get('enterpictureinpicture')).toEqual(expect.any(Function));
    rerender({ auto: false });
    expect(video.hasAttribute('autopictureinpicture')).toBe(false);
    expect(handlers.get('enterpictureinpicture')).toBeNull();
    unmount();
  });

  it('explains a refusal in plain words', async () => {
    const { video } = floatingVideo();
    video.requestPictureInPicture = vi.fn(() =>
      Promise.reject(new DOMException('No video', 'InvalidStateError')),
    );
    const ref = { current: video };
    const { result } = renderHook(() =>
      usePictureInPicture(ref, { auto: false, enabled: true, title: 'Porch' }),
    );
    await act(async () => {
      result.current.toggle();
      await Promise.resolve();
    });
    expect(result.current.error).toMatch(/floating window/u);
  });

  it('reports no support where the browser has none (Firefox)', () => {
    const video = document.createElement('video');
    expect(pictureInPictureSupported(video)).toBe(false);
  });
});
