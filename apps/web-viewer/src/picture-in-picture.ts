import { type RefObject, useCallback, useEffect, useState } from 'react';

import { androidApp, isAndroidApp, onAndroidPip } from './android-shell';

/** Safari's older presentation-mode API (iPhone/iPad and macOS Safari). */
interface WebKitVideo extends HTMLVideoElement {
  webkitPresentationMode?: 'inline' | 'picture-in-picture' | 'fullscreen';
  webkitSetPresentationMode?: (
    mode: 'inline' | 'picture-in-picture' | 'fullscreen',
  ) => void;
  webkitSupportsPresentationMode?: (mode: 'picture-in-picture') => boolean;
}

/** Whether this browser can show a video in a floating window. Firefox has
 * no API for it; its own PiP toggle on the video still works there. */
export function pictureInPictureSupported(video: HTMLVideoElement): boolean {
  const webkit = video as WebKitVideo;
  if (
    typeof document !== 'undefined' &&
    document.pictureInPictureEnabled === true &&
    typeof video.requestPictureInPicture === 'function'
  )
    return true;
  return (
    typeof webkit.webkitSupportsPresentationMode === 'function' &&
    typeof webkit.webkitSetPresentationMode === 'function' &&
    webkit.webkitSupportsPresentationMode('picture-in-picture')
  );
}

function isInPictureInPicture(video: HTMLVideoElement): boolean {
  return (
    document.pictureInPictureElement === video ||
    (video as WebKitVideo).webkitPresentationMode === 'picture-in-picture'
  );
}

async function enter(video: HTMLVideoElement): Promise<void> {
  const webkit = video as WebKitVideo;
  if (typeof video.requestPictureInPicture === 'function') {
    await video.requestPictureInPicture();
    return;
  }
  webkit.webkitSetPresentationMode?.('picture-in-picture');
}

async function exit(video: HTMLVideoElement): Promise<void> {
  if (document.pictureInPictureElement === video) {
    await document.exitPictureInPicture();
    return;
  }
  const webkit = video as WebKitVideo;
  if (webkit.webkitPresentationMode === 'picture-in-picture')
    webkit.webkitSetPresentationMode?.('inline');
}

export interface PictureInPicture {
  /** This browser can float the video. */
  supported: boolean;
  /** The video is floating right now. */
  active: boolean;
  /** Why the last attempt failed, in plain words; '' when it didn't. */
  error: string;
  toggle: () => void;
}

/**
 * Picture-in-picture for the live view (ADR 0088): the camera keeps playing
 * in a small always-on-top window while you use other apps or tabs.
 *
 * With `auto`, it also floats on its own when you leave:
 * - Chrome and Edge: Media Session `enterpictureinpicture`
 * - Safari on iPhone and iPad: the `autopictureinpicture` attribute
 *
 * When the live view closes, the floating window closes with it, since its
 * stream ends.
 */
export function usePictureInPicture(
  videoRef: RefObject<HTMLVideoElement | null>,
  options: { auto: boolean; enabled: boolean; title: string },
): PictureInPicture {
  const { auto, enabled, title } = options;
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [error, setError] = useState('');
  // Inside the Android app the page cannot float a video itself; the app floats the whole window instead (ADR 0121)
  // and the page shows only the picture while it is small.
  const [inApp, setInApp] = useState(false);

  useEffect(() => {
    if (!enabled || !isAndroidApp()) return;
    let current = true;
    void androidApp.hello().then(
      (hello) => current && setInApp(hello.pip === true),
      () => undefined,
    );
    const stop = onAndroidPip((open) => {
      setActive(open);
      document.documentElement.classList.toggle('android-pip', open);
    });
    return () => {
      current = false;
      stop();
      document.documentElement.classList.remove('android-pip');
    };
  }, [enabled]);

  useEffect(() => {
    if (!inApp || !enabled || !auto) return;
    void androidApp.pipReady(true).catch(() => undefined);
    return () => {
      void androidApp.pipReady(false).catch(() => undefined);
    };
  }, [auto, enabled, inApp]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled) {
      setSupported(false);
      setActive(false);
      return;
    }
    setSupported(pictureInPictureSupported(video));
    const sync = () => setActive(isInPictureInPicture(video));
    video.addEventListener('enterpictureinpicture', sync);
    video.addEventListener('leavepictureinpicture', sync);
    video.addEventListener('webkitpresentationmodechanged', sync);
    return () => {
      video.removeEventListener('enterpictureinpicture', sync);
      video.removeEventListener('leavepictureinpicture', sync);
      video.removeEventListener('webkitpresentationmodechanged', sync);
      // The stream ends with the live view; don't leave an empty window.
      if (isInPictureInPicture(video)) void exit(video).catch(() => undefined);
    };
  }, [enabled, videoRef]);

  // Float automatically when leaving the tab or app.
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !enabled || !auto) return;
    video.setAttribute('autopictureinpicture', '');
    const session =
      typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    let handlerSet = false;
    if (session) {
      try {
        session.setActionHandler(
          'enterpictureinpicture' as MediaSessionAction,
          () => void enter(video).catch(() => undefined),
        );
        handlerSet = true;
      } catch {
        // Older browsers don't know this action; manual PiP still works.
      }
    }
    return () => {
      video.removeAttribute('autopictureinpicture');
      if (handlerSet)
        try {
          session?.setActionHandler(
            'enterpictureinpicture' as MediaSessionAction,
            null,
          );
        } catch {
          /* Same as above. */
        }
    };
  }, [auto, enabled, videoRef]);

  // Name the floating window and the OS media controls after the camera.
  useEffect(() => {
    const session =
      typeof navigator !== 'undefined' ? navigator.mediaSession : undefined;
    if (!enabled || !session || typeof MediaMetadata === 'undefined') return;
    session.metadata = new MediaMetadata({
      album: 'Beacon',
      artist: 'Live camera',
      artwork: [
        { sizes: '512x512', src: '/icons/icon-512.png', type: 'image/png' },
      ],
      title,
    });
    return () => {
      session.metadata = null;
    };
  }, [enabled, title]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    setError('');
    if (inApp) {
      if (!active)
        void androidApp
          .enterPip()
          .catch(() =>
            setError('The video couldn’t open in a floating window.'),
          );
      return;
    }
    const attempt = isInPictureInPicture(video) ? exit(video) : enter(video);
    void attempt.catch(() =>
      setError(
        'The video couldn’t open in a floating window. Wait for it to start playing, then try again.',
      ),
    );
  }, [active, inApp, videoRef]);

  return { active, error, supported: supported || inApp, toggle };
}
