// 登場人物の絵。画像ファイルは使わない。
// 丸い餅の体に、色つきの前掛け。絵を描き足すキャラクターは、髪・目の色・持ち物を characters.ts に書く。
// それ以外の名前（前の試合の記録）は、ひとりずつ違うかぶりものを着けた「餅の従業員さん」。

import { artOf } from './characters.ts';
import { clamp01, INK, MOCHI, rand, ZUNDA, ZUNDA_DARK } from './theme.ts';
import type { CastColor, Ctx } from './theme.ts';

export type Mood = 'normal' | 'happy' | 'worried' | 'shock' | 'sly';

export interface ActorLook {
  x: number;
  /** 足もとの高さ。 */
  y: number;
  scale: number;
  color: CastColor;
  /** かぶりものの種類（席の番号から決める）。 */
  style: number;
  /** 画面の時刻（まばたき・ゆれに使う）。 */
  time: number;
  /** ひとりずつ動きをずらすための数。 */
  seed: number;
  facing?: -1 | 1;
  walking?: boolean;
  /** ずんだ餅になっている（内部の名前 asleep は、前の題材のなごり）。 */
  asleep?: boolean;
  /** 口の開き（0〜1）。話している時に動かす。 */
  talk?: number;
  /** 目線（-1〜1）。 */
  lookX?: number;
  lookY?: number;
  mood?: Mood;
  alpha?: number;
  /** 跳ねる高さ（体の大きさに対する割合）。 */
  hop?: number;
  /** 影を描くか。 */
  shadow?: boolean;
  /** 持ち場で手を動かしている（体を小さくはずませて、両手を交互に動かす）。 */
  working?: boolean;
  /** 心だけの姿（うすく、青白く、床から少し浮いている。影は無い）。 */
  dream?: boolean;
  /** ずんだの妖精の羽（役職を見せている時だけ）。 */
  wings?: boolean;
  /** 狐のしっぽ（役職を見せている時だけ）。 */
  tail?: boolean;
  /** 登場人物の名前（characters.ts に絵があれば、その見た目で描く）。 */
  character?: string;
  /** 歩く足どり・手の動きに使う時刻（無ければ time）。絵をゆっくり流す所では、試合の中の時計を渡して、足どりも遅くする。 */
  pace?: number;
}

const R = 22; // 体の半径（scale 1 のとき）

export function drawActor(ctx: Ctx, look: ActorLook): void {
  if (look.asleep) {
    drawMochiForm(ctx, look);
    return;
  }
  const { time, seed } = look;
  // 心だけの姿は、色をうすくして青白く見せる
  const color = look.dream ? { main: look.color.light, dark: '#8e9fd0', light: look.color.light } : look.color;
  const s = look.scale;
  const facing = look.facing ?? 1;
  const pace = look.pace ?? time;
  const phase = pace * 9 + seed * 1.7;
  const work = pace * 11 + seed * 2.3;
  const bob = look.walking ? Math.abs(Math.sin(phase)) * 2.6 : look.working ? Math.abs(Math.sin(work)) * 1.9 : Math.sin(time * 2.2 + seed) * 0.9;
  const squash = look.walking ? 1 + Math.sin(phase * 2) * 0.03 : look.working ? 1 + Math.sin(work * 2) * 0.035 : 1 + Math.sin(time * 2.2 + seed) * 0.015;
  const hop = ((look.hop ?? 0) + (look.dream ? 0.16 + Math.sin(time * 1.9 + seed) * 0.05 : 0)) * R * 2;

  ctx.save();
  ctx.globalAlpha *= (look.alpha ?? 1) * (look.dream ? 0.62 : 1);
  ctx.translate(look.x, look.y);
  ctx.scale(s, s);

  if (look.dream) {
    // 足もとの、うすい光の輪
    ctx.beginPath();
    ctx.ellipse(0, 1, R * 0.9, R * 0.26, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(190, 205, 255, 0.4)';
    ctx.fill();
  } else if (look.shadow !== false) {
    ctx.beginPath();
    ctx.ellipse(0, 1, R * (0.95 - hop / 160), R * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40, 24, 10, 0.25)';
    ctx.fill();
  }

  ctx.translate(0, -bob - hop);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (look.wings) drawWings(ctx, time, seed, facing);
  if (look.tail) drawTail(ctx, time, seed, facing);
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = INK;

  // 足
  const step = look.walking ? Math.sin(phase) * 4 : 0;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 8 + (side === 1 ? step : -step) * 0.6, -1 + (look.walking ? Math.max(0, side * Math.sin(phase)) * -2 : 0), 6, 4, 0, 0, Math.PI * 2);
    ctx.fillStyle = color.dark;
    ctx.fill();
    ctx.stroke();
  }

  // 体（餅）
  const art = artOf(look.character);
  const pose = { facing, time, seed, mood: look.mood ?? 'normal' } as const;
  ctx.save();
  ctx.translate(0, -R * 0.98);
  ctx.scale(2 - squash, squash);
  if (art?.back) layer(ctx, () => art.back?.(ctx, pose));
  const body = new Path2D();
  body.ellipse(0, 0, R, R * 0.94, 0, 0, Math.PI * 2);
  ctx.fillStyle = look.dream ? '#eef2ff' : MOCHI;
  ctx.fill(body);
  // 前掛け（体の下半分に色）
  ctx.save();
  ctx.clip(body);
  ctx.fillStyle = color.main;
  ctx.beginPath();
  ctx.moveTo(-R, R * 0.2);
  ctx.quadraticCurveTo(0, R * 0.52, R, R * 0.2);
  ctx.lineTo(R, R);
  ctx.lineTo(-R, R);
  ctx.closePath();
  ctx.fill();
  // 前掛けのひも
  ctx.strokeStyle = color.dark;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-R, R * 0.2);
  ctx.quadraticCurveTo(0, R * 0.52, R, R * 0.2);
  ctx.stroke();
  // ほっぺのつや
  ctx.fillStyle = 'rgba(255,255,255,0.55)';
  ctx.beginPath();
  ctx.ellipse(-R * 0.45, -R * 0.55, R * 0.22, R * 0.12, -0.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.6;
  ctx.stroke(body);

  if (art) {
    layer(ctx, () => art.hair(ctx, pose));
    drawFace(ctx, look, facing, art.eye);
    if (art.accessory) layer(ctx, () => art.accessory?.(ctx, pose));
  } else {
    drawFace(ctx, look, facing);
    drawHeadwear(ctx, look.style, color, facing);
  }

  // 手（仕込みの最中は、体の前で交互に上げ下げする）
  const wave = look.walking ? Math.sin(phase) * 3 : 0;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    if (look.working) ctx.ellipse(side * (R * 0.52) + facing * R * 0.34, R * 0.02 + Math.sin(work + (side === 1 ? 0 : Math.PI)) * R * 0.3, 4.8, 5.8, 0, 0, Math.PI * 2);
    else ctx.ellipse(side * (R - 1), R * 0.18 + side * wave * 0.5, 4.6, 5.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = look.dream ? '#eef2ff' : MOCHI;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  ctx.restore();
}

/** 絵の部品を描く（線の色や太さを、あとの手や顔に持ち越さない）。 */
function layer(ctx: Ctx, draw: () => void): void {
  ctx.save();
  draw();
  ctx.restore();
}

function drawFace(ctx: Ctx, look: ActorLook, facing: number, eye?: string): void {
  const { time, seed } = look;
  const mood = look.mood ?? 'normal';
  const shift = facing * 2.2 + (look.lookX ?? 0) * 2.4;
  const lookY = (look.lookY ?? 0) * 1.6;
  // まばたき（数秒に一度、ひとりずつずらす）
  const blinkAt = (time + rand(seed) * 4) % (3.2 + rand(seed + 5) * 2);
  const blink = blinkAt < 0.12;
  ctx.save();
  ctx.translate(shift, -R * 0.1 + lookY);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2;
  for (const side of [-1, 1]) {
    const ex = side * 7.2;
    if (blink || mood === 'happy') {
      ctx.beginPath();
      if (mood === 'happy') ctx.arc(ex, 0.5, 3, Math.PI, 0);
      else {
        ctx.moveTo(ex - 3, 0);
        ctx.lineTo(ex + 3, 0);
      }
      ctx.stroke();
    } else if (mood === 'shock') {
      ctx.beginPath();
      ctx.arc(ex, 0, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(ex, 0, 1.4, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
    } else if (eye) {
      // 色のついた目（ふち・ひとみ・光）
      ctx.beginPath();
      ctx.ellipse(ex, 0, 2.8, mood === 'sly' ? 2.1 : 3.6, 0, 0, Math.PI * 2);
      ctx.fillStyle = eye;
      ctx.fill();
      ctx.lineWidth = 1.3;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(ex, 0.4, 1.6, mood === 'sly' ? 1.3 : 2.4, 0, 0, Math.PI * 2);
      ctx.fillStyle = INK;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 0.9, -1.2, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.fillStyle = INK;
      ctx.lineWidth = 2.2;
    } else {
      ctx.beginPath();
      ctx.ellipse(ex, 0, 2.5, mood === 'sly' ? 2 : 3.3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(ex + 0.8, -1.1, 0.9, 0, Math.PI * 2);
      ctx.fillStyle = '#fff';
      ctx.fill();
      ctx.fillStyle = INK;
    }
    // まゆ
    if (mood === 'worried' || mood === 'sly') {
      ctx.beginPath();
      const tilt = mood === 'worried' ? -side * 1.6 : side * 1.8;
      ctx.moveTo(ex - 3.2, -6.2 + tilt);
      ctx.lineTo(ex + 3.2, -6.2 - tilt);
      ctx.stroke();
    }
  }
  // ほっぺ
  ctx.fillStyle = 'rgba(240, 120, 120, 0.45)';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * 11.5, 4.6, 3.4, 2.2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  // 口
  const talk = clamp01(look.talk ?? 0);
  ctx.fillStyle = '#b5443a';
  ctx.beginPath();
  if (talk > 0.08) {
    ctx.ellipse(0, 6.4, 2.6 + talk * 1.2, 1 + talk * 3.4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (mood === 'shock') {
    ctx.ellipse(0, 7, 2.2, 2.8, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (mood === 'worried') {
    ctx.arc(0, 8.6, 3, Math.PI * 1.15, Math.PI * 1.85);
    ctx.stroke();
  } else if (mood === 'sly') {
    ctx.moveTo(-3.4, 5.6);
    ctx.quadraticCurveTo(0.5, 8.6, 4, 4.6);
    ctx.stroke();
  } else {
    ctx.arc(0, 4.6, 3, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.restore();
}

/** かぶりもの。4種類を席の番号で回す（色だけに頼らずに見分けられるようにする）。 */
function drawHeadwear(ctx: Ctx, style: number, color: CastColor, facing: number): void {
  ctx.save();
  ctx.lineWidth = 2.4;
  ctx.strokeStyle = INK;
  ctx.fillStyle = color.main;
  const kind = ((style % 4) + 4) % 4;
  if (kind === 0) {
    // 三角巾
    ctx.beginPath();
    ctx.moveTo(-R * 0.92, -R * 0.42);
    ctx.quadraticCurveTo(0, -R * 1.5, R * 0.92, -R * 0.42);
    ctx.quadraticCurveTo(0, -R * 0.74, -R * 0.92, -R * 0.42);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-facing * R * 0.86, -R * 0.5);
    ctx.lineTo(-facing * R * 1.28, -R * 0.2);
    ctx.lineTo(-facing * R * 0.96, -R * 0.22);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (kind === 1) {
    // ねじり鉢巻
    ctx.beginPath();
    ctx.moveTo(-R * 0.95, -R * 0.48);
    ctx.quadraticCurveTo(0, -R * 0.92, R * 0.95, -R * 0.48);
    ctx.lineWidth = 7.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 4;
    ctx.strokeStyle = color.main;
    ctx.stroke();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = INK;
    for (const dy of [-6, 5]) {
      ctx.beginPath();
      ctx.ellipse(facing * R * 0.98, -R * 0.5 + dy, 3.4, 6, facing * 0.5 + dy * 0.05, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  } else if (kind === 2) {
    // 和帽子
    ctx.beginPath();
    ctx.moveTo(-R * 0.82, -R * 0.56);
    ctx.lineTo(-R * 0.7, -R * 1.22);
    ctx.quadraticCurveTo(0, -R * 1.42, R * 0.7, -R * 1.22);
    ctx.lineTo(R * 0.82, -R * 0.56);
    ctx.quadraticCurveTo(0, -R * 0.86, -R * 0.82, -R * 0.56);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-R * 0.8, -R * 0.74);
    ctx.quadraticCurveTo(0, -R * 1.02, R * 0.8, -R * 0.74);
    ctx.strokeStyle = color.dark;
    ctx.stroke();
  } else {
    // 大きなリボン
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -R * 0.92);
      ctx.quadraticCurveTo(side * R * 0.9, -R * 1.62, side * R * 0.86, -R * 0.98);
      ctx.quadraticCurveTo(side * R * 0.8, -R * 0.66, 0, -R * 0.92);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.arc(0, -R * 0.94, 4.4, 0, Math.PI * 2);
    ctx.fillStyle = color.dark;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** ずんだの妖精の羽。体の後ろに、うすく透ける4枚の羽。ゆっくり羽ばたく。 */
/** 狐のしっぽ。体のうしろ（向きと反対側）で、ゆらゆら揺れる。先は白い。 */
function drawTail(ctx: Ctx, time: number, seed: number, facing: number): void {
  const sway = Math.sin(time * 3.2 + seed) * 0.16;
  ctx.save();
  ctx.translate(-facing * R * 0.62, -R * 0.62);
  ctx.scale(-facing, 1);
  ctx.rotate(-0.55 + sway);
  const body = new Path2D();
  body.moveTo(0, R * 0.22);
  body.bezierCurveTo(R * 0.55, R * 0.5, R * 1.25, R * 0.15, R * 1.42, -R * 0.55);
  body.bezierCurveTo(R * 1.2, -R * 0.42, R * 0.9, -R * 0.62, R * 0.62, -R * 0.42);
  body.bezierCurveTo(R * 0.38, -R * 0.26, R * 0.12, -R * 0.2, 0, -R * 0.2);
  body.closePath();
  ctx.fillStyle = '#e8892e';
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.beginPath();
  ctx.ellipse(R * 1.32, -R * 0.42, R * 0.34, R * 0.3, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = '#fff8ec';
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = '#5a3416';
  ctx.stroke(body);
  ctx.restore();
}

function drawWings(ctx: Ctx, time: number, seed: number, facing: number): void {
  const flap = Math.sin(time * 7 + seed) * 0.14;
  ctx.save();
  ctx.translate(-facing * R * 0.25, -R * 1.15);
  for (const side of [-1, 1]) {
    for (const [lift, len, wide, tilt] of [[-0.18, 1.05, 0.5, -0.55], [0.32, 0.72, 0.36, 0.35]] as const) {
      ctx.save();
      ctx.scale(side, 1);
      ctx.rotate(tilt - flap * (lift < 0 ? 1 : 0.6));
      ctx.beginPath();
      ctx.ellipse(R * (0.55 + len * 0.45), R * lift, R * len * 0.62, R * wide * 0.62, 0, 0, Math.PI * 2);
      const g = ctx.createLinearGradient(R * 0.4, 0, R * (0.6 + len), 0);
      g.addColorStop(0, 'rgba(214, 245, 196, 0.75)');
      g.addColorStop(1, 'rgba(190, 228, 255, 0.35)');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(95, 143, 44, 0.85)';
      ctx.stroke();
      // 羽の筋
      ctx.beginPath();
      ctx.moveTo(R * 0.55, R * lift);
      ctx.quadraticCurveTo(R * (0.7 + len * 0.3), R * (lift - wide * 0.15), R * (0.55 + len * 0.85), R * lift);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(95, 143, 44, 0.5)';
      ctx.stroke();
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * ずんだ餅になった人。ひらたい白い餅に、緑のずんだを載せ、その人の色のリボンを結んである。
 * 目を閉じて、ぷるんとゆれる。上に、緑のきらきらが、ときどき光る。
 */
function drawMochiForm(ctx: Ctx, look: ActorLook): void {
  const { color, time, seed } = look;
  const s = look.scale;
  const wobble = Math.sin(time * 2.1 + seed) * 0.035;
  ctx.save();
  ctx.globalAlpha *= look.alpha ?? 1;
  ctx.translate(look.x, look.y);
  ctx.scale(s, s);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  if (look.shadow !== false) {
    ctx.beginPath();
    ctx.ellipse(0, 2, R * 1.25, R * 0.3, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(40, 24, 10, 0.22)';
    ctx.fill();
  }

  ctx.save();
  ctx.translate(0, -R * 0.55);
  ctx.scale(1 + wobble, 1 - wobble);
  // 餅
  const body = new Path2D();
  body.ellipse(0, 0, R * 1.18, R * 0.6, 0, 0, Math.PI * 2);
  ctx.fillStyle = MOCHI;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  // 下のほうの、やわらかい影
  ctx.fillStyle = 'rgba(214, 196, 160, 0.35)';
  ctx.beginPath();
  ctx.ellipse(0, R * 0.5, R * 1.3, R * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // その人の色の帯（かけ紙）
  ctx.fillStyle = color.main;
  ctx.fillRect(R * 0.38, -R, R * 0.3, R * 2);
  ctx.strokeStyle = color.dark;
  ctx.lineWidth = 1.6;
  ctx.strokeRect(R * 0.38, -R, R * 0.3, R * 2);
  ctx.restore();
  ctx.lineWidth = 2.6;
  ctx.strokeStyle = INK;
  ctx.stroke(body);

  // ずんだ（ふちが、ぽこぽこ）
  ctx.beginPath();
  const top = -R * 0.3;
  ctx.moveTo(-R * 0.98, top + R * 0.1);
  ctx.quadraticCurveTo(-R * 0.86, -R * 0.78, 0, -R * 0.8);
  ctx.quadraticCurveTo(R * 0.86, -R * 0.78, R * 0.98, top + R * 0.1);
  const bumps = 6;
  for (let i = bumps; i > 0; i--) {
    const x0 = -R * 0.98 + ((i - 0.5) / bumps) * R * 1.96;
    const x1 = -R * 0.98 + ((i - 1) / bumps) * R * 1.96;
    ctx.quadraticCurveTo(x0, top + R * (0.3 + (i % 2) * 0.08), x1, top + R * 0.1);
  }
  ctx.closePath();
  ctx.fillStyle = ZUNDA;
  ctx.fill();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // 豆のつぶ
  ctx.fillStyle = ZUNDA_DARK;
  for (const [bx, by] of [[-0.5, -0.5], [-0.12, -0.62], [0.3, -0.48], [0.62, -0.36], [-0.72, -0.28], [0.08, -0.32]] as const) {
    ctx.beginPath();
    ctx.ellipse(R * bx, R * by, R * 0.08, R * 0.055, bx, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
  ctx.beginPath();
  ctx.ellipse(-R * 0.35, -R * 0.66, R * 0.2, R * 0.07, -0.2, 0, Math.PI * 2);
  ctx.fill();

  // 顔（目を閉じて、すやすや）
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  for (const dx of [-R * 0.42, -R * 0.02]) {
    ctx.beginPath();
    ctx.arc(dx, R * 0.08, 2.6, Math.PI * 0.15, Math.PI * 0.85);
    ctx.stroke();
  }
  ctx.fillStyle = 'rgba(240, 120, 120, 0.45)';
  for (const dx of [-R * 0.66, R * 0.2]) {
    ctx.beginPath();
    ctx.ellipse(dx, R * 0.26, 3.2, 2, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(-R * 0.22, R * 0.26, 2, Math.PI * 0.2, Math.PI * 0.8);
  ctx.stroke();

  // リボン（その人の色）
  ctx.save();
  ctx.translate(R * 0.53, -R * 0.12);
  ctx.fillStyle = color.main;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 1.8;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(side * R * 0.42, -R * 0.36, side * R * 0.38, R * 0.02);
    ctx.quadraticCurveTo(side * R * 0.34, R * 0.2, 0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 3.4, 0, Math.PI * 2);
  ctx.fillStyle = color.dark;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // 誰だったかが分かるように、持ち物（耳・飾り）を餅の上に小さく残す
  const art = artOf(look.character);
  if (art?.accessory) {
    ctx.save();
    ctx.translate(0, -R * 0.17);
    ctx.scale(0.62, 0.62);
    art.accessory(ctx, { facing: 1, time, seed, mood: 'normal', onMochi: true });
    ctx.restore();
  }
  ctx.restore();

  // 緑のきらきら（ゆっくり光っては消える）。名簿の丸い枠の中では出さない
  for (let i = 0; i < (look.shadow === false ? 0 : 3); i++) {
    const k = (time * 0.5 + i / 3 + rand(seed + i) * 0.5) % 1;
    const a = Math.sin(k * Math.PI);
    if (a <= 0.05) continue;
    const sx = (-R * 0.9 + rand(seed * 7 + i) * R * 1.8) + Math.sin(k * 5 + i) * 3;
    const sy = -R * 1.25 - k * R * 1.1;
    sparkle(ctx, sx, sy, (2.6 + a * 2.6), `rgba(156, 204, 82, ${a * 0.95})`);
  }
  ctx.restore();
}

/** 4つの角を持つ、小さなきらめき。 */
export function sparkle(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.moveTo(x, y - r * 1.6);
  ctx.quadraticCurveTo(x, y, x + r * 1.6, y);
  ctx.quadraticCurveTo(x, y, x, y + r * 1.6);
  ctx.quadraticCurveTo(x, y, x - r * 1.6, y);
  ctx.quadraticCurveTo(x, y, x, y - r * 1.6);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
}

/** 丸い枠に入れた顔（名簿に使う）。 */
export function drawPortrait(ctx: Ctx, x: number, y: number, radius: number, look: Omit<ActorLook, 'x' | 'y' | 'scale'> & { dim?: boolean }): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = look.dim ? '#d8d2c4' : look.color.light;
  ctx.fill();
  ctx.save();
  ctx.clip();
  if (look.dim) ctx.filter = 'grayscale(0.85)';
  const scale = radius / 27;
  drawActor(ctx, { ...look, x, y: y + radius * (look.asleep ? 0.45 : 1.02), scale: look.asleep ? scale * 1.15 : scale, shadow: false, walking: false });
  ctx.restore();
  // ふち（体を描いたあとなので、円をもう一度なぞる）
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(2.5, radius / 9);
  ctx.strokeStyle = look.dim ? '#8d877a' : look.color.dark;
  ctx.stroke();
  ctx.restore();
}
