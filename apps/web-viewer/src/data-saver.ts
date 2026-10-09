import { useEffect, useState } from 'react';

/**
 * Data saver (ADR 0091). A viewer can ask any camera to send less video by
 * adding a bandwidth line (`b=AS`) to its SDP answer. The camera's encoder
 * then lowers bitrate and, if needed, resolution. No camera or server
 * change is needed, and it only affects what this viewer receives.
 */
const KEY = 'beacon.viewing.data-saver.v1';

/** Video cap while Data saver is on, in kilobits per second. */
export const DATA_SAVER_KBPS = 400;
/** Camera wall tiles are small; they never need more than this. */
export const WALL_TILE_KBPS = 350;

const EVENT = 'beacon:data-saver';

export function loadDataSaver(): boolean {
  try {
    return localStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function saveDataSaver(enabled: boolean): void {
  try {
    localStorage.setItem(KEY, String(enabled));
  } catch {
    // The choice then lasts for this page only.
  }
  window.dispatchEvent(new CustomEvent<boolean>(EVENT, { detail: enabled }));
}

/** The current setting; follows changes from Settings and other tabs. */
export function useDataSaver(): boolean {
  const [enabled, setEnabled] = useState(loadDataSaver);
  useEffect(() => {
    const onChange = (event: Event) =>
      setEnabled((event as CustomEvent<boolean>).detail);
    const onStorage = (event: StorageEvent) => {
      if (event.key === KEY) setEnabled(loadDataSaver());
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener('storage', onStorage);
    };
  }, []);
  return enabled;
}

/**
 * Adds `b=AS:<kbps>` to the video section of an SDP, replacing any existing
 * bandwidth line there. Other sections (audio) are untouched.
 */
export function limitVideoBitrate(sdp: string, kbps: number): string {
  const lines = sdp.split(/\r?\n/u);
  const newline = sdp.includes('\r\n') ? '\r\n' : '\n';
  const output: string[] = [];
  let inVideo = false;
  let inserted = false;
  for (const line of lines) {
    if (line.startsWith('m=')) {
      inVideo = line.startsWith('m=video');
      inserted = false;
    }
    if (inVideo && line.startsWith('b=AS:')) continue;
    output.push(line);
    // A bandwidth line belongs right after the connection (c=) line.
    if (inVideo && !inserted && line.startsWith('c=')) {
      output.push(`b=AS:${Math.max(30, Math.round(kbps))}`);
      inserted = true;
    }
  }
  return output.join(newline);
}
