// 立ち絵（集会で話している人の、胸から上の絵）。この公開版には立ち絵が無いので、集会では丸い餅の顔を描く。

import type { Ctx } from './theme.ts';

export interface BustOptions {
  x: number;
  chinY: number;
  headSize: number;
  y: number;
  width: number;
  height: number;
  talk?: number;
  alpha?: number;
  face?: 'left' | 'right';
}

export function hasPortrait(_name: string): boolean {
  return false;
}

/** 立ち絵を描く。描けなければ false（呼ぶ側が、餅の顔を描く）。 */
export function drawBust(_ctx: Ctx, _name: string, _options: BustOptions): boolean {
  return false;
}
