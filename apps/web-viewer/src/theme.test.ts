import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const css = readFileSync('src/styles.css', 'utf8');

function luminance(hex: string) {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

describe('semantic theme contrast', () => {
  const blocks = [...css.matchAll(/:root\s*\{([^}]+)\}/g)];
  it('checks both light and dark palettes', () =>
    expect(blocks).toHaveLength(2));
  for (const [index, block] of blocks.entries()) {
    const tokens: Record<string, string> = {};
    for (const match of block[1]!.matchAll(/(--[\w-]+):\s*(#[a-f\d]{6})/gi)) {
      tokens[match[1]!] = match[2]!;
    }
    it(`keeps normal text and primary actions above 4.5:1 in ${index ? 'dark' : 'light'} mode`, () => {
      const pairs = ['--surface-primary', '--surface-secondary'].flatMap(
        (surface) =>
          [
            '--text-primary',
            '--text-secondary',
            '--text-muted',
            '--status-online',
            '--status-live',
            '--status-offline',
          ].map((text) => [text, surface]),
      );
      pairs.push(
        ['--text-on-action', '--action-primary'],
        ['--text-on-action', '--action-primary-hover'],
      );
      for (const [foreground, background] of pairs) {
        const a = luminance(tokens[foreground!]!);
        const b = luminance(tokens[background!]!);
        expect(
          (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          `${foreground} on ${background}`,
        ).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});
