// 案内役の帯: 続けて話す言葉の間で、帯が消えたり薄くなったりしない。

import { describe, expect, it } from 'vitest';
import { barAlpha, BAR_JOIN, pickBar } from '../src/narrator-bar.ts';

describe('案内役の帯', () => {
  const lines = [
    { at: 0, end: 3 },
    { at: 3.1, end: 6 },
    { at: 8, end: 10 },
  ];

  it('間が短い言葉どうしは、次の言葉の始まりまで前の言葉を出し、入りと終わりで薄くしない', () => {
    const gap = pickBar(lines, 3.05);
    expect(gap?.item).toBe(lines[0]);
    expect(gap?.next).toBe(true);
    expect(barAlpha(gap!.item, 3.05, gap!)).toBe(1);
    const second = pickBar(lines, 3.12);
    expect(second?.item).toBe(lines[1]);
    expect(second?.prev).toBe(true);
    expect(barAlpha(second!.item, 3.12, second!)).toBe(1);
  });

  it('間が長い所では、帯をいったん消す（入りと終わりは、ふわっと）', () => {
    expect(8 - 6).toBeGreaterThan(BAR_JOIN);
    expect(pickBar(lines, 7)).toBeNull();
    const third = pickBar(lines, 8.05);
    expect(third?.prev).toBe(false);
    expect(barAlpha(third!.item, 8.05, third!)).toBeLessThan(0.5);
    const last = pickBar(lines, 9.99);
    expect(last?.next).toBe(false);
    expect(barAlpha(last!.item, 9.99, last!)).toBeLessThan(0.5);
  });
});
