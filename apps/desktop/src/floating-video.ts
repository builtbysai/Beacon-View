import type { WebContents } from 'electron';

/**
 * Keeps a live camera playing while the Beacon window is minimized or
 * closed to the tray (ADR 0088). Browsers float a playing video when you
 * leave the tab; a desktop window has no tab, so the shell does it.
 *
 * Only the full live view qualifies: the page marks that one video
 * `autopictureinpicture` (Home tiles never are), and it must be playing.
 * The scripts are fixed strings and run with a user gesture, which the
 * Picture-in-Picture API requires.
 */
const FLOAT_LIVE_VIDEO = `(() => {
  const video = document.querySelector('video[autopictureinpicture]');
  if (document.pictureInPictureElement) return 'floating';
  if (!video || video.paused || video.readyState < 2) return 'none';
  if (typeof video.requestPictureInPicture !== 'function') return 'none';
  return video.requestPictureInPicture().then(() => 'floated', () => 'none');
})()`;

/** Closes a floating window the shell opened, when the window comes back. */
const DOCK_LIVE_VIDEO = `(() => {
  const video = document.pictureInPictureElement;
  if (!video || !video.hasAttribute('autopictureinpicture')) return false;
  return document.exitPictureInPicture().then(() => true, () => false);
})()`;

export class FloatingVideo {
  // Only a window the shell floated is docked again; one the person opened
  // with the PiP button stays until they close it.
  #floated = false;
  #watching = false;

  /** Someone may be watching a floating camera, so the app must not
   * restart (e.g. for an update) until its window is back. */
  get watching(): boolean {
    return this.#watching;
  }

  async float(contents: WebContents): Promise<void> {
    if (contents.isDestroyed()) return;
    const result: unknown = await contents
      .executeJavaScript(FLOAT_LIVE_VIDEO, true)
      .catch(() => 'none');
    if (result === 'floated') this.#floated = true;
    this.#watching = result === 'floated' || result === 'floating';
  }

  async dock(contents: WebContents): Promise<void> {
    this.#watching = false;
    if (!this.#floated || contents.isDestroyed()) return;
    this.#floated = false;
    await contents.executeJavaScript(DOCK_LIVE_VIDEO, true).catch(() => false);
  }
}
