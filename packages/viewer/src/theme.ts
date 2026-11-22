// 上映画面の色・文字・小道具。画像ファイルは使わず、すべてこの場で描く。
// 文字は機体に入っている書体で描く（書体ファイルは持たない）。

import type { Role } from '../../protocol/src/index.ts';
import { modelLabel } from '../../server/src/lineup.ts';

export type { Role };

export const W = 1920;
export const H = 1080;
export const FONT = '"Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';

export const INK = '#3b2a1e';
export const PAPER = '#fbf3e0';
export const PAPER_DARK = '#efe2c4';
export const WOOD = '#8a5a36';
export const WOOD_DARK = '#5e3b22';
export const ZUNDA = '#9ccc52';
export const ZUNDA_DARK = '#5f8f2c';
export const MOCHI = '#fffaf0';
export const NIGHT = '#1d2440';
/** 役職の呼び名（内部の名前 nibbler は、前の題材のなごり）。 */
export const ROLE_LABEL: Record<Role, string> = { artisan: '従業員', nibbler: 'ずんだの妖精', madman: '妖精マニア', fox: '狐', seer: '占い師' };
/** 狭い所に出す時の呼び名。 */
export const ROLE_SHORT: Record<Role, string> = { artisan: '従業員', nibbler: '妖精', madman: '妖精マニア', fox: '狐', seer: '占い師' };
export const ROLE_COLOR: Record<Role, string> = { artisan: '#4f8a3a', nibbler: '#c0392b', madman: '#7d3c98', fox: '#d9771f', seer: '#6741d9' };
/** 役職を見せている時の、名札の地の色（従業員は名札の色をそのまま使う）。 */
export const ROLE_TAG: Record<Role, string | null> = { artisan: null, nibbler: 'rgba(160, 30, 22, 0.9)', madman: 'rgba(98, 40, 120, 0.9)', fox: 'rgba(196, 98, 14, 0.92)', seer: 'rgba(95, 61, 196, 0.92)' };
/** 勝ち負けの側。妖精マニアは、妖精が勝てば勝ち。狐はひとりだけの側。 */
export type SideName = 'artisan' | 'nibbler' | 'fox';
export const SIDE_OF: Record<Role, SideName> = { artisan: 'artisan', nibbler: 'nibbler', madman: 'nibbler', fox: 'fox', seer: 'artisan' };
/** 従業員の側ではない役（妖精・妖精マニア・狐）。仕込みはふりだけ。占い師は従業員の側で、仕込みも本物。 */
export const isOutsider = (role: Role): boolean => SIDE_OF[role] !== 'artisan';
/** 役職の小さな札に書く、短い呼び名（従業員には札を付けない）。 */
export const ROLE_CHIP: Record<Role, string> = { artisan: '', nibbler: '妖精', madman: 'マニア', fox: '狐', seer: '占い師' };
/** クビになった人について、全員に知らされること（妖精だったかどうか。狐は「狐だった」。2026-11-21 から）。 */
export function ejectVerdict(role: Role): { text: string; fairy: boolean; fox: boolean } {
  return role === 'nibbler' ? { text: '妖精だった', fairy: true, fox: false } : role === 'fox' ? { text: '狐だった', fairy: false, fox: true } : { text: '妖精ではなかった', fairy: false, fox: false };
}

/** 観戦者にだけ見せる、本当の役職の一言（全員に知らされたことと同じなら null）。 */
export function ejectTruth(role: Role, withMadman: boolean): string | null {
  if (role === 'madman') return `本当は${ROLE_LABEL.madman}`;
  // 狐は、全員に「狐だった」と知らされる（2026-11-21 から）
  if (role === 'seer') return `本当は${ROLE_LABEL.seer}`;
  if (role === 'artisan' && withMadman) return `${ROLE_LABEL.artisan}だった`;
  return null;
}

/** ずんだ餅になった人の色（名簿や見取り図）。 */
export const MOCHI_INK = '#4f7a22';

export interface CastColor {
  main: string;
  dark: string;
  light: string;
}

// 登場人物の色（前掛けと名札に使う）。12人が見分けられるようにずらした。案内役は、ずんだの緑
const NAMED: Record<string, CastColor> = {
  案内役: { main: '#56b04a', dark: '#2f7a2a', light: '#cdeec4' },
  あかね: { main: '#d9483b', dark: '#9c2c24', light: '#f6b9b2' },
  あおい: { main: '#3562c9', dark: '#1f3f8f', light: '#b3c6f2' },
  みどり: { main: '#4aa84f', dark: '#2c7031', light: '#bfe5c1' },
  きいろ: { main: '#e6bd1f', dark: '#a8860d', light: '#f8e9a6' },
  こはく: { main: '#d9822b', dark: '#9a5613', light: '#f5cfa3' },
  すみれ: { main: '#8d63c9', dark: '#5e3c93', light: '#d6c5ef' },
  ひすい: { main: '#27ae96', dark: '#157565', light: '#aee5da' },
  つゆくさ: { main: '#52b4e8', dark: '#2a7fae', light: '#c2e6f8' },
  // 9人目から。前の8色と見分けがつくように、明るさと色みをずらしてある
  もえぎ: { main: '#a9cf2f', dark: '#6b8a12', light: '#e2f0ad' },
  あさぎ: { main: '#1f7183', dark: '#0f4653', light: '#a8d3dc' },
  さくら: { main: '#f29bbb', dark: '#b85781', light: '#fcdbe7' },
  やまぶき: { main: '#8f6a1c', dark: '#5b4210', light: '#e0cc9a' },
};
const SPARE: CastColor[] = [
  { main: '#c95f8f', dark: '#8f3560', light: '#f1c3d7' },
  { main: '#7a8a99', dark: '#4d5a66', light: '#d0d8df' },
  { main: '#a67c52', dark: '#6e4f30', light: '#e3cfb8' },
];

export function colorOf(name: string, seat: number): CastColor {
  return NAMED[name] ?? (SPARE[seat % SPARE.length] as CastColor);
}

/** 頭脳の短い呼び名（画面の小さな札に出す）。 */
export function brainLabel(brain: string | null): string {
  // 案内役の紹介の台詞と同じ名前にする
  return modelLabel(brain);
}

const capital = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

/** 頭脳のいちばん短い呼び名（名札の下など、狭い所に出す）。例: Haiku 5.5、Luna 6。 */
export function brainShort(brain: string | null): string {
  if (!brain || brain === 'scripted') return '台本';
  const model = brain.split(':')[1] ?? brain;
  const claude = /^claude-([a-z]+)-(\d+)(?:-(\d+))?$/.exec(model);
  if (claude) return `${capital(claude[1] as string)} ${claude[2]}${claude[3] ? `.${claude[3]}` : ''}`;
  const gpt = /^gpt-(\d+(?:\.\d+)?)-([a-z]+)$/.exec(model);
  if (gpt) return `${capital(gpt[2] as string)} ${gpt[1]}`;
  // gemini-4-argon → Gemini Argon（狭い所でも、どの会社の AI か分かるように）
  const gemini = /^gemini-(\d+(?:\.\d+)?)-([a-z]+)$/.exec(model);
  if (gemini) return `Gemini ${capital(gemini[2] as string)}`;
  return brainLabel(brain);
}

/** 頭脳を作った会社ごとの色（会社のロゴは使わず、色と名前で見分ける）。 */
export function brainInk(brain: string | null): string {
  if (!brain || brain === 'scripted') return '#8a7a63';
  if (brain.startsWith('claude')) return '#b4532f';
  if (brain.startsWith('codex')) return '#1f6b5a';
  if (/gemini/i.test(brain)) return '#2f5fc4';
  if (/grok/i.test(brain)) return '#2b2b2b';
  return '#5a4a3a';
}

/** 頭脳の札の幅（drawBrainChip と同じ計り方）。 */
export function brainChipWidth(ctx: Ctx, brain: string | null, size: number, short = false): number {
  setFont(ctx, size, 800);
  return ctx.measureText(short ? brainShort(brain) : brainLabel(brain)).width + size * 0.9 + size * 0.62 + size * 0.3;
}

/**
 * 頭脳の札（色つきの丸に、頭脳の呼び名）。x は左はし（align: 'center' なら真ん中）、y は真ん中。返すのは札の幅。
 * 誰がどの AI かを、話している時にいつでも見分けられるようにする。
 */
export function drawBrainChip(ctx: Ctx, x: number, y: number, brain: string | null, size: number, options: { short?: boolean; align?: 'left' | 'center'; alpha?: number } = {}): number {
  const label = options.short ? brainShort(brain) : brainLabel(brain);
  const ink = brainInk(brain);
  setFont(ctx, size, 800);
  const dot = size * 0.62;
  const w = ctx.measureText(label).width + size * 0.9 + dot + size * 0.3;
  const h = size * 1.45;
  const left = options.align === 'center' ? x - w / 2 : x;
  ctx.save();
  if (options.alpha !== undefined) ctx.globalAlpha *= options.alpha;
  roundRect(ctx, left, y - h / 2, w, h, h / 2);
  ctx.fillStyle = '#fffdf6';
  ctx.fill();
  ctx.lineWidth = Math.max(2, size * 0.12);
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(left + size * 0.45 + dot / 2, y, dot / 2, 0, Math.PI * 2);
  ctx.fillStyle = ink;
  ctx.fill();
  drawText(ctx, label, left + size * 0.45 + dot + size * 0.3, y + 1, { size, weight: 800, color: ink });
  ctx.restore();
  return w;
}

/** 内心に混ざった行動の名前（英字）を、ふつうの言葉に直す。画面に出す時だけの言い換えで、記録は変えない。 */
// 前の題材の記録（nap・nap_if_unseen）も、同じ言葉に直す
const ACTION_WORDS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\s*transform_if_unseen\s*/g, '「こっそり餅に変える」'],
  [/\s*nap_if_unseen\s*/g, '「こっそり餅に変える」'],
  [/\s*call_meeting\s*/g, '「鐘を鳴らす」'],
  [/\s*do_task\s*/g, '「仕込み」'],
  [/\s*move_to\s*/g, '「移動」'],
  [/\s*\bsabotage\b\s*/g, '「妨害」'],
  [/\s*\bsneak\b\s*/g, '「抜け道」'],
  [/\s*\bfix\b\s*/g, '「直す」'],
  [/\s*\btransform\b\s*/g, '「ずんだ餅に変える」'],
  [/\s*\bnap\b\s*/g, '「ずんだ餅に変える」'],
  [/\s*\breport\b\s*/g, '「知らせる」'],
  [/\s*\bfollow\b\s*/g, '「ついていく」'],
  [/\s*\bwait\b\s*/g, '「待つ」'],
];
export function plainThought(text: string): string {
  return ACTION_WORDS.reduce((out, [pattern, word]) => out.replace(pattern, word), text);
}

export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
export const easeOut = (x: number) => 1 - (1 - clamp01(x)) ** 3;
export const easeInOut = (x: number) => {
  const k = clamp01(x);
  return k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2;
};
/** はねて止まる動き。 */
export const easeBack = (x: number) => {
  const k = clamp01(x) - 1;
  return 1 + k * k * (2.70158 * k + 1.70158);
};
/** 0 → 1 → 0 と上がって下がる山（区間の頭と終わりをなめらかにする）。 */
export const hill = (x: number, edge = 0.2) => clamp01(Math.min(x / edge, (1 - x) / edge));

/** 決まった数から作る、いつも同じ 0〜1 の値（再生位置を動かしても絵が変わらないようにする）。 */
export function rand(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export const clockLabel = (seconds: number) => {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const k = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + k, y);
  ctx.arcTo(x + w, y, x + w, y + h, k);
  ctx.arcTo(x + w, y + h, x, y + h, k);
  ctx.arcTo(x, y + h, x, y, k);
  ctx.arcTo(x, y, x + w, y, k);
  ctx.closePath();
}

export interface TextStyle {
  size: number;
  color?: string;
  weight?: number;
  align?: CanvasTextAlign;
  baseline?: CanvasTextBaseline;
  /** ふち取りの色と太さ。 */
  stroke?: string;
  strokeWidth?: number;
  alpha?: number;
}

export function setFont(ctx: Ctx, size: number, weight = 600): void {
  ctx.font = `${weight} ${size}px ${FONT}`;
}

export function drawText(ctx: Ctx, text: string, x: number, y: number, style: TextStyle): void {
  ctx.save();
  setFont(ctx, style.size, style.weight ?? 600);
  ctx.textAlign = style.align ?? 'left';
  ctx.textBaseline = style.baseline ?? 'middle';
  if (style.alpha !== undefined) ctx.globalAlpha *= style.alpha;
  if (style.stroke) {
    ctx.lineJoin = 'round';
    ctx.lineWidth = style.strokeWidth ?? style.size / 5;
    ctx.strokeStyle = style.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = style.color ?? INK;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// 小さい仮名も行頭に置かない（「ビ／ィ」のように、名前が行の境目で切れないように）
const NO_LINE_START = new Set([...'、。，．！？）」』】〕…ー・～!?)ぁぃぅぇぉっゃゅょゎゕゖァィゥェォッャュョヮヵヶ']);

/** 幅に合わせて折り返す（日本語なので文字ごと。行頭に来てはいけない記号は前の行へ送る）。 */
export function wrapText(ctx: Ctx, text: string, maxWidth: number, size: number, weight = 600): string[] {
  ctx.save();
  setFont(ctx, size, weight);
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    if (ch === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (line !== '' && ctx.measureText(line + ch).width > maxWidth && !NO_LINE_START.has(ch)) {
      lines.push(line);
      line = ch === ' ' ? '' : ch;
    } else {
      line += ch;
    }
  }
  if (line !== '') lines.push(line);
  ctx.restore();
  return lines;
}

/** 文字を載せる枠の候補（文字の幅・大きさ・行数）。 */
export interface TextFrame {
  width: number;
  size: number;
  max: number;
}

/**
 * 枠の候補を順に試して、全文が入る最初の枠で折り返す（切らずに全部見せるため）。
 * どの枠にも入らない時だけ、最後の枠で切る。
 */
export function fitText(ctx: Ctx, text: string, frames: readonly TextFrame[], weight = 600): { rows: string[]; frame: TextFrame; cut: boolean } {
  for (const frame of frames) {
    const rows = wrapText(ctx, text, frame.width, frame.size, weight);
    if (rows.length <= frame.max) return { rows, frame, cut: false };
  }
  const frame = frames.at(-1) as TextFrame;
  return { rows: clampLines(wrapText(ctx, text, frame.width, frame.size, weight), frame.max), frame, cut: true };
}

/** 長すぎる文を、行数に収まるように切る。 */
export function clampLines(lines: string[], max: number): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(0, max);
  kept[max - 1] = `${[...(kept[max - 1] as string)].slice(0, -1).join('')}…`;
  return kept;
}

/** 木の札（文字を載せる板）。 */
export function plaque(ctx: Ctx, x: number, y: number, w: number, h: number, options: { fill?: string; edge?: string; radius?: number; shadow?: boolean } = {}): void {
  ctx.save();
  if (options.shadow !== false) {
    ctx.shadowColor = 'rgba(40, 24, 10, 0.35)';
    ctx.shadowBlur = 14;
    ctx.shadowOffsetY = 5;
  }
  roundRect(ctx, x, y, w, h, options.radius ?? 16);
  ctx.fillStyle = options.fill ?? PAPER;
  ctx.fill();
  ctx.restore();
  ctx.save();
  roundRect(ctx, x, y, w, h, options.radius ?? 16);
  ctx.lineWidth = 4;
  ctx.strokeStyle = options.edge ?? WOOD_DARK;
  ctx.stroke();
  ctx.restore();
}

/**
 * 餅に変わる瞬間に、まわりの人に付ける札。見た / 餅になるのだけ見た（誰の手かは見えなかった） / 仲間なので知らんぷり / 暗くて・壁で・遠くて見えない。
 * ルールの説明（見える範囲）でも、同じ札を使う。
 */
export type SightKind = 'saw' | 'half' | 'ally' | 'dark' | 'wall' | 'far';
const SIGHT_GREY = '#56606b';
export const SIGHT_TAG: Record<SightKind, { text: string; fill: string }> = {
  saw: { text: '見た！', fill: '#e8590c' },
  half: { text: '餅になるのだけ見た', fill: '#d9822b' },
  ally: { text: '仲間なので知らんぷり', fill: ROLE_COLOR.nibbler },
  dark: { text: '暗くて見えない', fill: SIGHT_GREY },
  wall: { text: '壁で見えない', fill: SIGHT_GREY },
  far: { text: '遠くて見えない', fill: SIGHT_GREY },
};

/** 吹き出しの形の小さな札（下の点が、その人を指す）。x, y は札の真ん中。 */
export function drawTag(ctx: Ctx, x: number, y: number, text: string, fill: string, options: { size?: number; alpha?: number } = {}): void {
  const size = options.size ?? 26;
  ctx.save();
  ctx.globalAlpha *= options.alpha ?? 1;
  setFont(ctx, size, 900);
  const w = ctx.measureText(text).width + size * 1.2;
  const h = size * 1.6;
  ctx.beginPath();
  ctx.moveTo(x - size * 0.36, y + h / 2 - 2);
  ctx.lineTo(x + size * 0.36, y + h / 2 - 2);
  ctx.lineTo(x, y + h / 2 + size * 0.42);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  roundRect(ctx, x - w / 2, y - h / 2, w, h, h / 2);
  ctx.fill();
  ctx.lineWidth = Math.max(2.5, size * 0.13);
  ctx.strokeStyle = '#fffdf6';
  ctx.stroke();
  drawText(ctx, text, x, y + 1, { size, weight: 900, color: '#fff', align: 'center' });
  ctx.restore();
}

/** ずんだ餅（緑のあんを載せた白い餅）。大きさ s は横幅の半分くらい。 */
export function zundaMochi(ctx: Ctx, x: number, y: number, s: number, sleepy = false): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.lineWidth = Math.max(1.5, s * 0.12);
  ctx.strokeStyle = INK;
  ctx.beginPath();
  ctx.ellipse(0, 0, s, s * 0.72, 0, 0, Math.PI * 2);
  ctx.fillStyle = MOCHI;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(0, -s * 0.22, s * 0.78, s * 0.46, 0, 0, Math.PI * 2);
  ctx.fillStyle = sleepy ? '#b9a4e0' : ZUNDA;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
