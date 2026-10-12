import { useEffect, useRef } from 'react';

/** Keyboard shortcuts for the live view (ADR 0090). */
export type ShortcutAction =
  | 'fullscreen'
  | 'pictureInPicture'
  | 'listen'
  | 'talk'
  | 'snapshot'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  | 'previousCamera'
  | 'nextCamera'
  | 'help';

export const SHORTCUT_HELP: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: 'F', label: 'Full screen' },
  { keys: 'P', label: 'Floating window (picture in picture)' },
  { keys: 'M', label: 'Listen or mute' },
  { keys: 'T', label: 'Talk (hold to talk, tap to toggle)' },
  { keys: 'S', label: 'Save a snapshot' },
  { keys: '+  −  0', label: 'Zoom in, out, reset' },
  { keys: '← →', label: 'Previous or next camera (pans when zoomed)' },
  { keys: '?', label: 'Show this list' },
];

interface KeyLike {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
}

/** The action a key stands for, or null. Modified keys are never shortcuts,
 * so browser and system combinations keep working. */
export function shortcutFor(event: KeyLike): ShortcutAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  switch (event.key) {
    case 'f':
    case 'F':
      return 'fullscreen';
    case 'p':
    case 'P':
      return 'pictureInPicture';
    case 'm':
    case 'M':
      return 'listen';
    case 't':
    case 'T':
      return 'talk';
    case 's':
    case 'S':
      return 'snapshot';
    case '+':
    case '=':
      return 'zoomIn';
    case '-':
    case '_':
      return 'zoomOut';
    case '0':
      return 'zoomReset';
    case 'ArrowLeft':
      return 'previousCamera';
    case 'ArrowRight':
      return 'nextCamera';
    case '?':
      return 'help';
    default:
      return null;
  }
}

/** Typing, dialogs, and menus own the keyboard. */
function keyboardBusy(target: EventTarget | null): boolean {
  const element = target instanceof Element ? target : null;
  if (element?.closest('input, textarea, select, [contenteditable="true"]'))
    return true;
  // A dialog, or an editor that owns the keyboard (e.g. motion zones).
  return (
    document.querySelector('dialog[open], [data-keyboard-busy="true"]') !== null
  );
}

interface ShortcutHandlers {
  on: (action: ShortcutAction) => void;
  /** Talk is the one action with a release (hold-to-talk). */
  talkRelease: () => void;
}

export function useLiveShortcuts(
  handlers: ShortcutHandlers,
  enabled: boolean,
): void {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (keyboardBusy(event.target)) return;
      const action = shortcutFor(event);
      if (!action) return;
      // Holding a key repeats keydown; only the first press counts.
      if (event.repeat) {
        event.preventDefault();
        return;
      }
      event.preventDefault();
      latest.current.on(action);
    }
    function onKeyUp(event: KeyboardEvent) {
      if (event.key === 't' || event.key === 'T') latest.current.talkRelease();
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [enabled]);
}
