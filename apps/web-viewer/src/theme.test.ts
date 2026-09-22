import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

// The new design token architecture moved tokens here.
const css = fs.readFileSync(
  path.join(process.cwd(), 'src/styles/tokens.css'),
  'utf8',
);

function luminance(hex: string) {
  const rgb = hex.match(/[a-f\d]{2}/gi)!.map((channel) => {
    const value = parseInt(channel, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return rgb[0]! * 0.2126 + rgb[1]! * 0.7152 + rgb[2]! * 0.0722;
}

describe('semantic theme contrast', () => {
  // Find all theme definition blocks: :root (light defaults), [data-theme="light"], [data-theme="dark"], @media (prefers-color-scheme: dark) { :root ... }
  const blocks = [
    ...css.matchAll(
      /(?::root|\[data-theme=['"].*?['"]\])(?:,\s*\[data-theme=['"].*?['"]\])*\s*\{([^}]+)\}/g,
    ),
  ];
  it('checks both light and dark palettes', () =>
    expect(blocks).toHaveLength(2));
  for (const [index, block] of blocks.entries()) {
    const tokens: Record<string, string> = {};
    for (const match of block[1]!.matchAll(/(--[\w-]+):\s*(#[a-f\d]{6})/gi)) {
      tokens[match[1]!] = match[2]!;
    }
    it(`keeps normal text and primary actions above 4.5:1 in ${index ? 'dark' : 'light'} mode`, () => {
      const pairs = ['--bg-base', '--bg-surface'].flatMap((surface) =>
        [
          '--text-primary',
          '--text-secondary',
          '--status-success',
          '--status-error',
        ].map((text) => [text, surface]),
      );
      pairs.push(
        ['--action-text', '--action-base'],
        ['--action-text', '--action-hover'],
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
