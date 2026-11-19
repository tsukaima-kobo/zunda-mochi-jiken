// 文字を枠に収める: 集会の内心は、長くても切らずに全文を出す。

import { describe, expect, it } from 'vitest';
import { THOUGHT_FRAMES } from '../src/scenes.ts';
import { fitText } from '../src/theme.ts';
import type { Ctx } from '../src/theme.ts';

/** 文字の幅だけを測る、絵を描かない ctx（全角は文字の大きさ、半角はその 0.6 倍）。 */
function fakeCtx(): Ctx {
  const state = { font: '' };
  return {
    save() {},
    restore() {},
    get font() {
      return state.font;
    },
    set font(value: string) {
      state.font = value;
    },
    measureText(text: string) {
      const size = Number(/(\d+)px/.exec(state.font)?.[1] ?? 10);
      const width = [...text].reduce((sum, ch) => sum + (ch.charCodeAt(0) < 128 ? size * 0.6 : size), 0);
      return { width } as TextMetrics;
    },
  } as unknown as Ctx;
}

describe('文字を枠に収める', () => {
  const ctx = fakeCtx();
  const frames = [
    { width: 100, size: 10, max: 1 },
    { width: 200, size: 10, max: 1 },
    { width: 200, size: 10, max: 2 },
  ];

  it('全文が入る最初の枠を選ぶ', () => {
    expect(fitText(ctx, 'あ'.repeat(8), frames).frame).toBe(frames[0]);
    expect(fitText(ctx, 'あ'.repeat(15), frames).frame).toBe(frames[1]);
    const two = fitText(ctx, 'あ'.repeat(30), frames);
    expect(two.frame).toBe(frames[2]);
    expect(two.rows.join('')).toBe('あ'.repeat(30));
    expect(two.cut).toBe(false);
  });

  it('どの枠にも入らない時だけ、最後の枠で切る', () => {
    const cut = fitText(ctx, 'あ'.repeat(50), frames);
    expect(cut.cut).toBe(true);
    expect(cut.rows).toHaveLength(2);
    expect(cut.rows[1]?.endsWith('…')).toBe(true);
  });

  it('集会の内心は、160字あっても切らない（実戦の最長は156字）', () => {
    const thought = '見たのは、2:08にこはくが洗い場から蒸し場へ入ったところ。'.repeat(6).slice(0, 160);
    const fit = fitText(ctx, thought, THOUGHT_FRAMES);
    expect(fit.cut).toBe(false);
    expect(fit.rows.join('')).toBe(thought);
  });

  it('短い内心は、いつもの大きさの雲のまま', () => {
    expect(fitText(ctx, 'あ'.repeat(60), THOUGHT_FRAMES).frame).toBe(THOUGHT_FRAMES[0]);
  });
});
