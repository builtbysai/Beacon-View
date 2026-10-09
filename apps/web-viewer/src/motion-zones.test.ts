import { describe, expect, it } from 'vitest';

import {
  cellAtPoint,
  cellsBetween,
  describeZones,
  paintCells,
  pictureRect,
  ZONE_COUNT,
} from './motion-zones';

const picture = { height: 160, left: 0, top: 0, width: 320 };

describe('motion zone grid', () => {
  it('numbers cells row by row from the top-left', () => {
    expect(cellAtPoint(1, 1, picture)).toBe(0);
    expect(cellAtPoint(319, 1, picture)).toBe(15);
    expect(cellAtPoint(1, 11, picture)).toBe(16);
    expect(cellAtPoint(319, 159, picture)).toBe(ZONE_COUNT - 1);
  });

  it('ignores points outside the picture', () => {
    expect(cellAtPoint(-1, 10, picture)).toBeNull();
    expect(cellAtPoint(320, 10, picture)).toBeNull();
    expect(cellAtPoint(10, 160, picture)).toBeNull();
    expect(cellAtPoint(10, 10, { ...picture, width: 0 })).toBeNull();
  });

  it('leaves no gaps in a fast drag', () => {
    const cells = cellsBetween({ x: 2, y: 5 }, { x: 318, y: 5 }, picture);
    expect(cells.sort((a, b) => a - b)).toEqual(
      Array.from({ length: 16 }, (_, column) => column),
    );
  });

  it('paints and erases without changing the original set', () => {
    const start = new Set([1, 2]);
    const painted = paintCells(start, [3, 4, 999], true);
    expect([...painted].sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
    expect(
      [...paintCells(painted, [1, 4], false)].sort((a, b) => a - b),
    ).toEqual([2, 3]);
    expect(start.size).toBe(2);
  });

  it('finds the part of the frame a letterboxed picture covers', () => {
    // A 4:3 picture in a wide frame: bars on the left and right.
    const rect = pictureRect(
      { height: 300, width: 800 },
      { height: 480, width: 640 },
    );
    expect(rect.height).toBeCloseTo(300);
    expect(rect.width).toBeCloseTo(400);
    expect(rect.left).toBeCloseTo(200);
    expect(rect.top).toBeCloseTo(0);
    // Before the first frame, the whole frame stands in.
    expect(
      pictureRect({ height: 300, width: 800 }, { height: 0, width: 0 }),
    ).toEqual({
      height: 300,
      left: 0,
      top: 0,
      width: 800,
    });
  });

  it('describes how many areas are ignored', () => {
    expect(describeZones(0)).toBe('No areas ignored');
    expect(describeZones(1)).toBe('1 area ignored');
    expect(describeZones(12)).toBe('12 areas ignored');
  });
});
