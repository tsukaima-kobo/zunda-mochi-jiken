// 案内役の言葉の帯。番組の言葉の場面と、試合の場面の中の一言（上映の画面）で同じ見た目にする。

import { NARRATOR } from '../../server/src/narration.ts';
import { mouthAt, revealedChars } from '../../speech/src/index.ts';
import type { SpeechClip } from '../../speech/src/index.ts';
import { drawActor } from './actors.ts';
import { BLIP_SPAN } from './sound.ts';
import { clamp01, clampLines, colorOf, drawText, easeOut, plaque, roundRect, W, wrapText, ZUNDA, ZUNDA_DARK } from './theme.ts';
import type { Ctx } from './theme.ts';

/** 試合の場面では、上映の下の帯（できごと・内心）にぴったり重ねる。 */
export const PLAY_BAR = { x: 20, y: 936, w: W - 40, h: 128 };
const NAV_GREEN = '#2f6b2a';

export interface NarratorWords {
  at: number;
  end: number;
  text: string;
  clip: SpeechClip | null;
  /** 話す人（省くと案内役）。紹介では本人が話す。 */
  speaker?: string;
}

/** 続けて話す言葉の間がこれより短い時は、帯を消さずに出したままにする（間で下の帯が透けて見えないように）。 */
export const BAR_JOIN = 0.5;

/** 言葉の並び（時刻の順）から、いま帯に出す言葉と、前後の言葉と続いているかを選ぶ。続いている時は、次の言葉の始まりまで出したままにする。 */
export function pickBar<T extends { at: number; end: number }>(items: readonly T[], time: number): { item: T; prev: boolean; next: boolean } | null {
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const before = items[i - 1];
    const after = items[i + 1];
    const prev = !!before && item.at - before.end < BAR_JOIN;
    const next = !!after && after.at - item.end < BAR_JOIN;
    const until = next && after ? Math.max(item.end, after.at) : item.end;
    if (time >= item.at && time < until) return { item, prev, next };
  }
  return null;
}

/** 帯の濃さ。前の言葉と続いていれば入りで薄くせず、次の言葉と続いていれば終わりで薄くしない。 */
export function barAlpha(words: { at: number; end: number }, time: number, join: { prev: boolean; next: boolean } = { prev: false, next: false }): number {
  const fadeIn = join.prev ? 1 : easeOut((time - words.at) / 0.25);
  const fadeOut = join.next ? 1 : clamp01((words.end - time) / 0.2 + 0.3);
  return clamp01(fadeIn * fadeOut);
}

/** 声に合わせて、いま出ている文字。 */
export function shownWords(words: NarratorWords, time: number): string {
  const chars = [...words.text];
  const spoken = words.clip ? words.clip.seconds : (words.end - words.at) * BLIP_SPAN;
  return chars.slice(0, revealedChars(chars.length, time - words.at, words.clip?.phrases, spoken)).join('');
}

/** 口の開き。音声があれば口の動きの記録、無ければ文字が出ている間ゆらす。 */
export function narratorTalk(words: NarratorWords, time: number): number {
  const local = time - words.at;
  if (words.clip?.mouth) return mouthAt(words.clip.mouth, local);
  const span = (words.end - words.at) * BLIP_SPAN;
  return local >= 0 && local < span ? Math.max(0, Math.sin(local * 17)) * 0.8 : 0;
}

/**
 * 帯を描く。box は帯の位置、textX は文字の左はし、tagX は名前の札の左はし。
 * face: 'inside' は帯の左に案内役の顔を描く（試合の場面）。'none' は描かない（呼ぶ側が描く）。
 */
export function drawNarratorBar(
  ctx: Ctx,
  words: NarratorWords,
  time: number,
  layout: { box: { x: number; y: number; w: number; h: number }; textX: number; tagX: number; face: 'inside' | 'none'; join?: { prev: boolean; next: boolean } },
): void {
  const local = time - words.at;
  const k = barAlpha(words, time, layout.join);
  const { x, y, w, h } = layout.box;
  ctx.save();
  ctx.globalAlpha = clamp01(k);
  plaque(ctx, x, y, w, h, { fill: 'rgb(36, 82, 33)', edge: '#1c3d19', radius: 26, shadow: true });
  ctx.lineWidth = 3;
  ctx.strokeStyle = ZUNDA;
  roundRect(ctx, x + 8, y + 8, w - 16, h - 16, 20);
  ctx.stroke();
  plaque(ctx, layout.tagX, y - 30, 196, 50, { fill: ZUNDA, edge: ZUNDA_DARK, radius: 16 });
  drawText(ctx, words.speaker ?? NARRATOR, layout.tagX + 98, y - 5, { size: 28, weight: 900, color: NAV_GREEN, align: 'center' });
  const text = shownWords(words, time);
  const rows = clampLines(wrapText(ctx, words.text, x + w - 60 - layout.textX, 40, 800), 2);
  let used = 0;
  rows.forEach((row, i) => {
    const part = [...row].slice(0, Math.max(0, [...text].length - used)).join('');
    used += [...row].length;
    drawText(ctx, part, layout.textX, y + (rows.length === 1 ? h / 2 + 4 : 46 + i * 50), { size: 40, weight: 800, color: '#fffaf0' });
  });
  ctx.restore();
  if (layout.face === 'inside') {
    ctx.save();
    ctx.globalAlpha = clamp01(k);
    drawActor(ctx, { color: colorOf(NARRATOR, 0), style: 0, time, seed: 7.7, character: NARRATOR, talk: narratorTalk(words, time), mood: 'happy', facing: 1, hop: Math.max(0, Math.sin(local * 3)) * 0.03, x: x + 100, y: y + h + 8, scale: 2.9 });
    ctx.restore();
  }
}

/** 試合の場面での帯（上映の下の帯に重ねる）。 */
export function drawPlayNarration(ctx: Ctx, words: NarratorWords, time: number, join?: { prev: boolean; next: boolean }): void {
  drawNarratorBar(ctx, words, time, { box: PLAY_BAR, textX: PLAY_BAR.x + 220, tagX: PLAY_BAR.x + 190, face: 'inside', ...(join ? { join } : {}) });
}
