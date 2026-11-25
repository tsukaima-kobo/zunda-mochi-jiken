// 人狼が人をずんだ餅に変える直前の、見せ場の差し込み（カットイン）。役職を見せている時だけ出す。
// 画面を暗くして、人狼の色の帯を斜めに走らせ、左に人狼、右にねらわれた人を大きく映して、決めぜりふを打ち出す。
// 人狼の杖の先から、ずんだの光がねらわれた人へ飛び、ぽんと煙が立って、ねらわれた人がずんだ餅に変わる（誰が誰を餅にしたかが、一目で分かる）。
// 人狼2人が同じ瞬間に変えた時は、2組を上下に並べる。終わりに白く光らせ、光が引くと、ふだんの絵に戻る。

import { mouthAt } from '../../speech/src/index.ts';
import { drawActor, sparkle, wandTip } from './actors.ts';
import type { ActorLook } from './actors.ts';
import type { Cutin } from './show.ts';
import { CUTIN_VOICE_DELAY } from './sound.ts';
import { brainChipWidth, clamp01, drawBrainChip, drawText, easeBack, easeOut, H, rand, roundRect, setFont, W, ZUNDA } from './theme.ts';
import type { CastColor, Ctx } from './theme.ts';

/** 白い光が引くまでの、差し込みの終わりからの秒数。 */
export const CUTIN_FLASH_AFTER = 0.3;

const BAND_H = 440;
const SLANT = 0.16;
const BODY_R = 22; // 登場人物の体の半径（scale 1 のとき。actors.ts と同じ）

/** 差し込みに出す1人（人狼か、ねらわれた人）。 */
export interface CutinPerson {
  name: string;
  look: Pick<ActorLook, 'color' | 'style' | 'time' | 'seed' | 'character'>;
  brain: string | null;
}

/** 1組（餅にした人狼と、餅にされた人）。 */
export interface CutinPair {
  by: CutinPerson;
  target: CutinPerson;
}

/** area: 暗がりと白い光で塗る範囲（省くと画面全体。縦長の画面では、縮めて描くので、窓の全体を渡す）。 */
export function drawCutin(ctx: Ctx, cut: Cutin, time: number, pairs: CutinPair[], area: { x: number; y: number; w: number; h: number } = { x: 0, y: 0, w: W, h: H }): void {
  const u = time - cut.at;
  const length = cut.end - cut.at;
  if (u < 0 || u > length + CUTIN_FLASH_AFTER || pairs.length === 0) return;
  const first = pairs[0] as CutinPair;
  const color = first.by.look.color;
  const cy = H * 0.48;
  const fade = clamp01((length - u) / 0.1);
  // 入り: 帯が上下に開く。出: 帯が細くなって消える
  const open = u < length ? Math.min(easeOut(u / 0.14), 1 - easeOut((u - (length - 0.16)) / 0.16)) : 0;
  // ねらわれた人が、ずんだ餅に変わる時刻（差し込みの中で見せる）
  const morphAt = length - 0.55;

  ctx.save();
  if (u < length) {
    // 暗がり
    ctx.fillStyle = `rgba(14, 8, 20, ${0.66 * Math.min(clamp01(u / 0.12), clamp01((length - u) / 0.12 + 0.2))})`;
    ctx.fillRect(area.x, area.y, area.w, area.h);
    drawBand(ctx, cut, u, open, color, cy);

    if (open > 0.6) {
      const double = pairs.length > 1;
      pairs.slice(0, 2).forEach((pair, row) => {
        // 1組: 大きく、名札は足もとの下 / 2組: 上下に小さく並べ、名札は内がわの横
        const scale = double ? 3.5 : 6;
        const feet = double ? cy - 30 + row * 235 : cy + 205;
        const left = double ? 300 + row * 40 : 400;
        const right = double ? W - 300 - row * 40 : W - 400;
        drawPair(ctx, cut, pair, u, length, morphAt, { scale, feet, left, right, double, row, fade });
      });
      drawSlogan(ctx, u, length, color, double ? { x: W / 2, y: 120, size: 0.62, lines: 1 } : { x: W / 2, y: cy - 110, size: 1, lines: 2 });
    }
  }
  // 白い光（帯が消える瞬間に強く光り、すぐ引く）
  const flash = u < length ? clamp01((u - (length - 0.1)) / 0.1) : 1 - clamp01((u - length) / CUTIN_FLASH_AFTER);
  if (flash > 0) {
    ctx.fillStyle = `rgba(255, 255, 250, ${0.85 * flash})`;
    ctx.fillRect(area.x, area.y, area.w, area.h);
  }
  ctx.restore();
}

/** 斜めの帯と、帯の中を流れる線と粒。 */
function drawBand(ctx: Ctx, cut: Cutin, u: number, open: number, color: CastColor, cy: number): void {
  const h = BAND_H * open;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-40, cy - h / 2 + W * SLANT * 0.5);
  ctx.lineTo(W + 40, cy - h / 2 - W * SLANT * 0.5);
  ctx.lineTo(W + 40, cy + h / 2 - W * SLANT * 0.5);
  ctx.lineTo(-40, cy + h / 2 + W * SLANT * 0.5);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, cy - h / 2, 0, cy + h / 2);
  fill.addColorStop(0, color.dark);
  fill.addColorStop(0.5, color.main);
  fill.addColorStop(1, color.dark);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.clip();
  // 走る線（左から右へ。人狼からねらわれた人へ向かう向き）
  for (let i = 0; i < 34; i++) {
    const y = cy - BAND_H / 2 + rand(i * 13.7 + cut.at) * BAND_H;
    const len = 160 + rand(i * 5.3) * 420;
    const speed = 2600 + rand(i * 2.9) * 1800;
    const x = -200 + ((u * speed + rand(i * 7.1) * W * 1.6) % (W * 1.6 + len)) - len;
    ctx.fillStyle = `rgba(255, 255, 255, ${0.12 + rand(i * 3.3) * 0.2})`;
    ctx.fillRect(x, y - W * SLANT * ((x - W / 2) / W), len, 3 + rand(i) * 4);
  }
  // ずんだの粒
  for (let i = 0; i < 18; i++) {
    const x = ((u * (900 + rand(i * 4.1) * 700) + rand(i * 9.2) * W) % (W + 200)) - 100;
    const y = cy - BAND_H * 0.42 + rand(i * 6.6 + 1) * BAND_H * 0.84 - W * SLANT * ((x - W / 2) / W);
    ctx.beginPath();
    ctx.arc(x, y, 6 + rand(i * 8.8) * 10, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(184, 228, 120, ${0.3 + rand(i) * 0.25})`;
    ctx.fill();
  }
  ctx.restore();
  // 帯のふち（白い線）
  ctx.save();
  ctx.lineWidth = 10;
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.92)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(-40, cy + (side * h) / 2 + W * SLANT * 0.5);
    ctx.lineTo(W + 40, cy + (side * h) / 2 - W * SLANT * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

interface PairLayout {
  scale: number;
  feet: number;
  left: number;
  right: number;
  double: boolean;
  row: number;
  fade: number;
}

/** 1組を描く: 左に人狼、右にねらわれた人、そのあいだを飛ぶずんだの光、名札。 */
function drawPair(ctx: Ctx, cut: Cutin, pair: CutinPair, u: number, length: number, morphAt: number, layout: PairLayout): void {
  const { scale, feet, double, row, fade } = layout;
  const body = BODY_R * scale;
  const delay = row * 0.06;
  // 人狼は左から、ねらわれた人は右から入ってくる
  const fx = layout.left - (1 - easeBack(clamp01((u - 0.04 - delay) / 0.28))) * (layout.left + 360) + u * 18;
  const vx = layout.right + (1 - easeOut(clamp01((u - 0.1 - delay) / 0.26))) * (W - layout.right + 360);
  const midY = feet - body * 0.95;
  const morphed = u >= morphAt;
  const hit = u > morphAt - 0.35 && !morphed;

  ctx.save();
  ctx.globalAlpha = fade;
  // 人狼の後ろの光
  const glow = ctx.createRadialGradient(fx, midY, 10, fx, midY, body * 2.2);
  glow.addColorStop(0, 'rgba(214, 246, 160, 0.7)');
  glow.addColorStop(1, 'rgba(214, 246, 160, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(fx - body * 2.3, midY - body * 2.3, body * 4.6, body * 4.6);
  const local = u - CUTIN_VOICE_DELAY;
  const talk = row === 0 && cut.clip?.mouth && local >= 0 ? mouthAt(cut.clip.mouth, local) : local >= 0 && local < 1.1 ? 0.3 + 0.7 * Math.abs(Math.sin(local * 14 + row)) : 0;
  // 杖をふる: 光が飛びはじめる前に、杖をふり上げてから相手のほうへふり下ろし、変わったあとに下ろす
  const reach = morphed ? 1 - clamp01((u - morphAt) / 0.3) : clamp01((u - 0.12) / 0.38);
  const wand = { side: 1 as const, k: reach, fall: morphed };
  drawActor(ctx, { ...pair.by.look, x: fx, y: feet, scale, facing: 1, mood: 'sly', wings: true, talk, shadow: false, ...(reach > 0 ? { reach: wand } : {}) });

  // ずんだの光（人狼の杖の先から、ねらわれた人へ）
  if (u > 0.5 && !morphed) {
    // 光の出どころは、ふり下ろした杖の先の星
    const tip = wandTip(fx, feet, scale, wand, pair.by.look.time, pair.by.look.seed);
    const hx = tip.x;
    const hy = tip.y;
    const tx = vx - body * 0.4;
    const ty = feet - body * 0.95;
    const grow = clamp01((u - 0.5) / 0.25);
    for (let i = 0; i < 16; i++) {
      const k = ((u * 1.8 + i / 16) % 1) * grow;
      const x = hx + (tx - hx) * k;
      const y = hy + (ty - hy) * k + Math.sin(k * Math.PI * 3 + u * 12 + i) * body * 0.12;
      ctx.beginPath();
      ctx.arc(x, y, (5 + rand(i * 3.7) * 7) * (scale / 6), 0, Math.PI * 2);
      ctx.fillStyle = i % 3 === 0 ? 'rgba(255, 250, 210, 0.95)' : 'rgba(170, 222, 100, 0.92)';
      ctx.fill();
    }
  }

  // ねらわれた人（光が届くと震え、ぽんと煙が立って、ずんだ餅に変わる）
  const shake = hit ? Math.sin(u * 90) * body * 0.05 : 0;
  drawActor(ctx, { ...pair.target.look, x: vx + shake, y: feet, scale: morphed ? scale * 0.95 : scale * 0.9, facing: -1, mood: 'shock', asleep: morphed, shadow: false });
  if (u > morphAt - 0.05) {
    const p = clamp01((u - (morphAt - 0.05)) / 0.35);
    ctx.save();
    ctx.globalAlpha *= 1 - p;
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + rand(i * 5.1);
      const r = body * (0.4 + p * 1.1);
      ctx.beginPath();
      ctx.arc(vx + Math.cos(a) * r, midY + Math.sin(a) * r * 0.8, body * (0.34 - p * 0.15), 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.fill();
    }
    ctx.restore();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + u * 2;
      const r = body * (0.8 + p * 0.9);
      sparkle(ctx, vx + Math.cos(a) * r, midY + Math.sin(a) * r * 0.8, (8 + 6 * (1 - p)) * (scale / 6), i % 2 ? '#fff6c2' : ZUNDA);
    }
  }

  // 名札（人狼: 「人狼」 / ねらわれた人: 「ねらわれた」→「ずんだ餅にされた」）
  const tagIn = easeOut(clamp01((u - 0.12 - delay) / 0.2));
  ctx.globalAlpha = fade * tagIn;
  const size = double ? 26 : 32;
  const culprit = { label: '人狼', labelColor: '#ffe27a', person: pair.by };
  const victim = { label: morphed ? 'ずんだ餅にされた' : 'ねらわれた', labelColor: '#ffffff', person: pair.target };
  if (double) {
    // 人狼の名札は、足もとの高さに（肩の高さだと、ふり下ろした杖に重なって杖が隠れる。2026-11-23 杖にした時に下げた）
    nameTag(ctx, fx + body * 1.15, feet - body * 0.3, 'left', culprit.label, culprit.labelColor, culprit.person, size);
    nameTag(ctx, vx - body * 1.15, feet - body * 1.05, 'right', victim.label, victim.labelColor, victim.person, size);
  } else {
    nameTag(ctx, layout.left, feet + 62, 'center', culprit.label, culprit.labelColor, culprit.person, size);
    nameTag(ctx, layout.right, feet + 62, 'center', victim.label, victim.labelColor, victim.person, size);
  }
  ctx.restore();
}

/** 名札: 上に小さく役目（人狼・ねらわれた）、その下に名前の札と頭脳の札。x は align の位置（左はし・真ん中・右はし）。 */
function nameTag(ctx: Ctx, x: number, y: number, align: 'left' | 'center' | 'right', label: string, labelColor: string, person: CutinPerson, size: number): void {
  setFont(ctx, size, 800);
  const pillW = ctx.measureText(person.name).width + size * 1.6;
  const chipSize = size * 0.75;
  const chipW = brainChipWidth(ctx, person.brain, chipSize, true);
  const total = pillW + 10 + chipW;
  const leftX = align === 'left' ? x : align === 'right' ? x - total : x - total / 2;
  // 役目の文字
  const labelX = align === 'left' ? leftX : align === 'right' ? leftX + total : leftX + total / 2;
  drawText(ctx, label, labelX, y - size * 1.25, { size: size * 0.82, color: labelColor, align: align === 'center' ? 'center' : align, weight: 900, stroke: '#1d1020', strokeWidth: 7 });
  // 名前の札
  const h = size * 1.6;
  roundRect(ctx, leftX, y - h / 2, pillW, h, h / 2);
  ctx.fillStyle = person.look.color.main;
  ctx.fill();
  ctx.lineWidth = 4;
  ctx.strokeStyle = '#fff';
  ctx.stroke();
  drawText(ctx, person.name, leftX + pillW / 2, y + 1, { size, color: '#fff', align: 'center', weight: 800, stroke: person.look.color.dark, strokeWidth: 6 });
  drawBrainChip(ctx, leftX + pillW + 10, y + 1, person.brain, chipSize, { short: true });
}

/** 決めぜりふ（どんと打ち出す）。 */
function drawSlogan(ctx: Ctx, u: number, length: number, color: CastColor, at: { x: number; y: number; size: number; lines: 1 | 2 }): void {
  const stamp = clamp01((u - 0.22) / 0.16);
  if (stamp <= 0) return;
  const k = (1 + (1 - easeOut(stamp)) * 0.9) * at.size;
  ctx.save();
  ctx.globalAlpha = clamp01(stamp * 3) * clamp01((length - u) / 0.1);
  ctx.translate(at.x, at.y);
  ctx.rotate(-0.07);
  ctx.scale(k, k);
  if (at.lines === 2) {
    drawText(ctx, 'ずんだ餅に、', -60, -50, { size: 92, color: '#fff', align: 'center', weight: 900, stroke: color.dark, strokeWidth: 18 });
    drawText(ctx, 'なぁれ！', 60, 64, { size: 132, color: '#fff7c8', align: 'center', weight: 900, stroke: color.dark, strokeWidth: 22 });
  } else {
    drawText(ctx, 'ずんだ餅に、なぁれ！', 0, 0, { size: 132, color: '#fff7c8', align: 'center', weight: 900, stroke: color.dark, strokeWidth: 22 });
  }
  ctx.restore();
}
