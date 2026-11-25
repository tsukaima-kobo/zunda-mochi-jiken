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
  /**
   * 杖をふっている（side: 相手のいる側。k: ふり具合 0〜1。fall: ふり終えて、杖を下ろしているところ）。
   * k の前半で、杖を頭の上へふり上げ、後半で相手のほうへふり下ろす。ふり下ろすと、杖の先の星がずんだ色に光る。
   */
  reach?: { side: -1 | 1; k: number; fall?: boolean };
  /** 心だけの姿（うすく、青白く、床から少し浮いている。影は無い）。 */
  dream?: boolean;
  /**
   * 人狼の印（役職を見せている時だけ）。灰色の狼の耳としっぽ。識別子 wings は、前の絵（羽）のなごり。
   */
  wings?: boolean;
  /** 妖狐のしっぽ（役職を見せている時だけ）。 */
  tail?: boolean;
  /** 占い師の玉（役職を見せている時だけ）。肩のうしろに、ふわふわ浮かぶ。 */
  orb?: boolean;
  /** 登場人物の名前（characters.ts に絵があれば、その見た目で描く）。 */
  character?: string;
  /** 歩く足どり・手の動きに使う時刻（無ければ time）。絵をゆっくり流す所では、試合の中の時計を渡して、足どりも遅くする。 */
  pace?: number;
}

const R = 22; // 体の半径（scale 1 のとき）
/** 杖をふった時に、杖を持つ手が体の横へ出る幅と、上がる高さ（体の半径に対する割合）。 */
export const REACH_OUT = 0.75;
export const REACH_UP = 0.5;
/** 杖の長さ（体の半径に対する割合）と、ふり上げた角度・ふり下ろした角度（真上が 0。相手の側へ倒すほど大きい）。 */
const WAND_LEN = 1.25;
const WAND_UP = -0.3;
// ふり下ろした杖は、相手の体のほうへ少し下向き（カットインの決めぜりふの文字に、星が隠れないように）
const WAND_DOWN = 1.65;

/** 杖を持つ手の位置（体の真ん中から。scale 1 の時の大きさ）。 */
function wandHand(side: -1 | 1, k: number, time: number, seed: number): { x: number; y: number } {
  return { x: side * (R - 1 + k * R * REACH_OUT), y: R * 0.18 - k * R * REACH_UP + Math.sin(time * 14 + seed) * k * 0.8 };
}

/** 杖の角度。k が半分を過ぎてから、ばねのように相手のほうへふり下ろす。下ろしている時は、相手に向けたまま。 */
function wandAngle(k: number, fall: boolean, time: number, seed: number): number {
  const shake = Math.sin(time * 14 + seed) * 0.05 * k;
  if (fall) return WAND_DOWN + shake;
  const p = clamp01((k - 0.5) / 0.5);
  const u = p - 1;
  const swing = p <= 0 ? 0 : 1 + 2.70158 * u * u * u + 1.70158 * u * u;
  return WAND_UP + (WAND_DOWN - WAND_UP) * swing + shake;
}

/**
 * 杖の先（星）の位置。x・y・scale は drawActor に渡すのと同じ（足もとの位置と大きさ）。カットイン（cutin.ts）の光の出どころに使う。
 * 体のはずみ（数ピクセル）は入れていない。
 */
export function wandTip(x: number, y: number, scale: number, reach: { side: -1 | 1; k: number; fall?: boolean }, time: number, seed: number): { x: number; y: number } {
  const k = clamp01(reach.k);
  const hand = wandHand(reach.side, k, time, seed);
  const a = wandAngle(k, reach.fall ?? false, time, seed);
  return { x: x + (hand.x + reach.side * Math.sin(a) * R * WAND_LEN) * scale, y: y + (-R * 0.98 + hand.y - Math.cos(a) * R * WAND_LEN) * scale };
}

/** 杖（木の棒の先に、ずんだ色の星）。手より先に描いて、手で握っているように見せる。 */
function drawWand(ctx: Ctx, side: -1 | 1, k: number, fall: boolean, time: number, seed: number): void {
  const hand = wandHand(side, k, time, seed);
  const a = wandAngle(k, fall, time, seed);
  const dx = side * Math.sin(a);
  const dy = -Math.cos(a);
  const tip = { x: hand.x + dx * R * WAND_LEN, y: hand.y + dy * R * WAND_LEN };
  const end = { x: hand.x - dx * R * 0.25, y: hand.y - dy * R * 0.25 };
  // 出す時と下ろす時は、杖をうすくする（ぱっと現れたり消えたりしないように）
  const alpha = fall ? clamp01(k / 0.4) : clamp01(k / 0.15);
  // ふり下ろしたあとの光（星のまわり）
  const glow = fall ? 0 : clamp01((k - 0.8) / 0.2);
  ctx.save();
  ctx.globalAlpha *= alpha;
  if (glow > 0) {
    const r = 14 + glow * 6 + Math.sin(time * 11) * 1.5;
    const halo = ctx.createRadialGradient(tip.x, tip.y, 2, tip.x, tip.y, r);
    halo.addColorStop(0, `rgba(230, 250, 190, ${0.9 * glow})`);
    halo.addColorStop(1, 'rgba(156, 204, 82, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // 棒（ふちを濃く、中を木の色に）
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 5.6;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
  ctx.strokeStyle = '#b07a43';
  ctx.lineWidth = 3;
  ctx.stroke();
  // 先の星（ゆっくり回る）
  const spin = time * 2.4 + seed;
  const outer = 7.4 + glow * 1.4;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outer : outer * 0.46;
    const t = spin + (i * Math.PI) / 5;
    const px = tip.x + Math.cos(t) * r;
    const py = tip.y + Math.sin(t) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = glow > 0 ? '#d9f29a' : ZUNDA;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = INK;
  ctx.stroke();
  // ふり下ろした瞬間の、小さなきらめき
  if (glow > 0) {
    for (let i = 0; i < 3; i++) {
      const t = time * 5 + i * 2.1 + seed;
      sparkle(ctx, tip.x + Math.cos(t) * (12 + i * 3), tip.y + Math.sin(t * 1.3) * (10 + i * 2), 2.4 * glow, `rgba(255, 250, 210, ${0.95 * glow})`);
    }
  }
  ctx.restore();
}

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
  if (look.wings) drawWolf(ctx, time, seed, facing);
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
  const reach = look.reach ? Math.max(0, Math.min(1, look.reach.k)) : 0;
  for (const side of [-1, 1]) {
    if (reach > 0 && look.reach && side === look.reach.side) {
      // 杖をふる: 相手の側の手で杖を持ち、頭の上へふり上げてから、相手のほうへふり下ろす。杖を先に描き、握っている手をその上に重ねる
      drawWand(ctx, side, reach, look.reach.fall ?? false, time, seed);
      ctx.lineWidth = 2.6;
      ctx.strokeStyle = INK;
      const hand = wandHand(side, reach, time, seed);
      ctx.beginPath();
      ctx.ellipse(hand.x, hand.y, 5.2 + reach * 0.8, 6.2 + reach * 1.4, side * 0.2 * reach, 0, Math.PI * 2);
      ctx.fillStyle = look.dream ? '#eef2ff' : MOCHI;
      ctx.fill();
      ctx.stroke();
      continue;
    }
    ctx.beginPath();
    if (look.working) ctx.ellipse(side * (R * 0.52) + facing * R * 0.34, R * 0.02 + Math.sin(work + (side === 1 ? 0 : Math.PI)) * R * 0.3, 4.8, 5.8, 0, 0, Math.PI * 2);
    else ctx.ellipse(side * (R - 1), R * 0.18 + side * wave * 0.5, 4.6, 5.6, 0, 0, Math.PI * 2);
    ctx.fillStyle = look.dream ? '#eef2ff' : MOCHI;
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  if (look.orb) drawOrb(ctx, time, seed, facing);
  ctx.restore();
}

/** 占い師の玉。向きと反対側の肩の上に浮かんで、ゆっくり光る（台は無い）。 */
function drawOrb(ctx: Ctx, time: number, seed: number, facing: number): void {
  const x = -facing * R * 1.18;
  const y = -R * 1.72 + Math.sin(time * 2.1 + seed) * 2.4;
  const r = R * 0.36;
  const glow = 0.6 + 0.4 * Math.sin(time * 3 + seed * 1.3);
  ctx.save();
  const halo = ctx.createRadialGradient(x, y, r * 0.3, x, y, r * 2.3);
  halo.addColorStop(0, `rgba(200, 170, 255, ${0.55 * glow})`);
  halo.addColorStop(1, 'rgba(200, 170, 255, 0)');
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.3, 0, Math.PI * 2);
  ctx.fill();
  const body = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
  body.addColorStop(0, '#ffffff');
  body.addColorStop(0.45, '#d0bfff');
  body.addColorStop(1, '#7048e8');
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#3b2a6e';
  ctx.stroke();
  // 玉の中の小さな星
  ctx.fillStyle = `rgba(255, 255, 255, ${0.5 + 0.5 * glow})`;
  ctx.beginPath();
  ctx.arc(x + r * 0.28, y + r * 0.2, r * 0.13, 0, Math.PI * 2);
  ctx.fill();
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

/** しっぽの色（妖狐は橙、人狼は灰色）。 */
const FOX_TAIL = { fill: '#e8892e', tip: '#fff8ec', edge: '#5a3416' };
const WOLF_TAIL = { fill: '#8d949e', tip: '#e9ecef', edge: '#343a40' };

/** 人狼の印: 灰色のしっぽと、頭の上の狼の耳（体のうしろに描くので、頭の上に出た所だけ見える）。 */
function drawWolf(ctx: Ctx, time: number, seed: number, facing: number): void {
  drawTail(ctx, time, seed + 1.7, facing, WOLF_TAIL);
  const twitch = Math.max(0, Math.sin(time * 2.3 + seed * 3)) ** 12 * 0.18;
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.translate(side * R * 0.52, -R * 1.62);
    ctx.rotate(side * (0.32 + (side === facing ? twitch : 0)));
    const ear = new Path2D();
    ear.moveTo(-R * 0.34, R * 0.12);
    ear.quadraticCurveTo(-R * 0.22, -R * 0.55, 0, -R * 0.86);
    ear.quadraticCurveTo(R * 0.22, -R * 0.55, R * 0.34, R * 0.12);
    ear.closePath();
    ctx.fillStyle = WOLF_TAIL.fill;
    ctx.fill(ear);
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = WOLF_TAIL.edge;
    ctx.stroke(ear);
    ctx.beginPath();
    ctx.moveTo(-R * 0.17, R * 0.02);
    ctx.quadraticCurveTo(-R * 0.1, -R * 0.4, 0, -R * 0.58);
    ctx.quadraticCurveTo(R * 0.1, -R * 0.4, R * 0.17, R * 0.02);
    ctx.closePath();
    ctx.fillStyle = '#f3c6c6';
    ctx.fill();
    ctx.restore();
  }
}

/** しっぽ（既定は妖狐の橙。人狼は灰色を渡す）。体のうしろ（向きと反対側）で、ゆらゆら揺れる。先は白い。 */
function drawTail(ctx: Ctx, time: number, seed: number, facing: number, color = FOX_TAIL): void {
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
  ctx.fillStyle = color.fill;
  ctx.fill(body);
  ctx.save();
  ctx.clip(body);
  ctx.beginPath();
  ctx.ellipse(R * 1.32, -R * 0.42, R * 0.34, R * 0.3, -0.6, 0, Math.PI * 2);
  ctx.fillStyle = color.tip;
  ctx.fill();
  ctx.restore();
  ctx.lineWidth = 2.2;
  ctx.strokeStyle = color.edge;
  ctx.stroke(body);
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
