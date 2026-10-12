import { describe, expect, it } from 'vitest';

import { browserOsLabel } from './naming';

describe('browserOsLabel', () => {
  it('names the Android app instead of showing its runtime string', () => {
    expect(
      browserOsLabel(
        'Dalvik/2.1.0 (Linux; U; Android 16; Pixel Build/BP22)',
        'x',
      ),
    ).toBe('Beacon for Android');
    expect(browserOsLabel('okhttp/4.12.0', 'x')).toBe('Beacon for Android');
  });

  it('keeps naming browsers and falls back when nothing is known', () => {
    expect(
      browserOsLabel(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'x',
      ),
    ).toBe('Chrome on Windows');
    expect(browserOsLabel(null, 'Signed-in device')).toBe('Signed-in device');
  });
});
