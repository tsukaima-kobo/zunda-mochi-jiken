// 登場人物ごとの描き足し（髪・目の色・持ち物）。この公開版の12人は、色の違う丸いずんだ餅なので、描き足しは無い。
// キャラクターを足す時は、ART に名前ごとの絵を書く。
//
// 座標は体の中心が原点（体の半径 R。上が負）。drawActor が、体の傾きとつぶれを付けた状態で呼ぶ。
//   back      体より後ろ（しっぽ・長い髪・背負い物）
//   hair      前髪（顔より先に描く。まゆは前髪の上に描かれる）
//   accessory 顔より手前（耳・飾り・持ち物）。ずんだ餅になったあとも、餅の上に小さく残す（onMochi）

import type { Mood } from './actors.ts';
import type { Ctx } from './theme.ts';

export const R = 22;

export interface Pose {
  /** 向き（1 は右、-1 は左）。 */
  facing: number;
  time: number;
  seed: number;
  mood: Mood;
  /** ずんだ餅になった体の上に、持ち物だけを小さく描いている時。 */
  onMochi?: boolean;
}

export interface CharacterArt {
  /** 目の色。 */
  eye: string;
  back?: (ctx: Ctx, pose: Pose) => void;
  hair: (ctx: Ctx, pose: Pose) => void;
  accessory?: (ctx: Ctx, pose: Pose) => void;
}

const ART: Record<string, CharacterArt> = {};

export function artOf(name: string | undefined): CharacterArt | null {
  return name ? (ART[name] ?? null) : null;
}

/** 絵のある登場人物の名前。 */
export const ART_NAMES = Object.keys(ART);
