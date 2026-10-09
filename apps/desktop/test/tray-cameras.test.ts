import { describe, expect, it } from 'vitest';

import {
  parseTrayCameras,
  showsWall,
  TRAY_CAMERA_LIMIT,
  trayCameraLabel,
  trayCameraPath,
} from '../src/tray-cameras.js';

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('tray cameras', () => {
  it('accepts a short list of IDs and names and tidies the names', () => {
    expect(
      parseTrayCameras([
        { id: id(1), name: '  Front   door ' },
        { id: id(2), name: 'Garage' },
      ]),
    ).toEqual([
      { id: id(1), name: 'Front door' },
      { id: id(2), name: 'Garage' },
    ]);
    expect(parseTrayCameras([])).toEqual([]);
  });

  it('rejects anything that is not a list of valid cameras', () => {
    for (const value of [
      null,
      'cameras',
      [null],
      [{ id: 'not-a-uuid', name: 'Door' }],
      [{ id: id(1), name: '' }],
      [{ id: id(1), name: '   ' }],
      [{ id: id(1), name: 5 }],
      [{ id: '../../etc/passwd', name: 'Door' }],
      Array.from({ length: TRAY_CAMERA_LIMIT + 1 }, (_, n) => ({
        id: id(n),
        name: 'Camera',
      })),
    ])
      expect(parseTrayCameras(value)).toBeNull();
  });

  it('only ever builds a same-origin camera path from an ID', () => {
    expect(trayCameraPath(id(7))).toBe(`/cameras/${id(7)}`);
  });

  it('shortens long names and escapes ampersands for the menu', () => {
    expect(trayCameraLabel({ id: id(1), name: 'Mom & Dad' })).toBe(
      'Watch Mom && Dad',
    );
    const label = trayCameraLabel({ id: id(1), name: 'x'.repeat(80) });
    expect(label.length).toBe('Watch '.length + 40);
    expect(label.endsWith('…')).toBe(true);
  });

  it('offers the wall only when there is more than one camera', () => {
    expect(showsWall([{ id: id(1), name: 'A' }])).toBe(false);
    expect(
      showsWall([
        { id: id(1), name: 'A' },
        { id: id(2), name: 'B' },
      ]),
    ).toBe(true);
  });
});
