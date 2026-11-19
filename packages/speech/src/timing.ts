// 音声合成エンジンの audio_query（モーラごとの長さ）から、音声のどこで何を言っているかを計算する。
// 口の開き（口パク）と、字幕を出す速さに使う。音声そのものには触らない。

import { splitPhrases } from './reading.ts';

export interface Mora {
  text: string;
  consonant: string | null;
  consonant_length: number | null;
  vowel: string;
  vowel_length: number;
  pitch: number;
}

export interface AccentPhrase {
  moras: Mora[];
  accent: number;
  pause_mora: Mora | null;
  is_interrogative: boolean;
}

/** audio_query の返り値のうち、時間の計算に使う所。 */
export interface AudioQuery {
  accent_phrases: AccentPhrase[];
  speedScale: number;
  pitchScale: number;
  intonationScale: number;
  volumeScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  pauseLength?: number | null;
  pauseLengthScale?: number;
  outputSamplingRate: number;
  kana?: string;
}

/** 音声の中の1つの音（子音・母音・間）。時刻は音声の頭からの秒。 */
export interface Segment {
  start: number;
  end: number;
  /** 'pau'（間）・'cl'（っ）・'N'（ん）・母音（a i u e o / 無声化は大文字）・子音 */
  phoneme: string;
  kind: 'consonant' | 'vowel' | 'pause' | 'silence';
  /** その音を含むアクセント句の番号（間と、頭と終わりの無音は -1）。 */
  phrase: number;
}

/** エンジンが音の長さを丸める単位（秒）。24000Hz で 256 サンプルごと。 */
export const FRAME = 256 / 24000;

const frames = (seconds: number, speed: number) => Math.max(0, Math.round(seconds / speed / FRAME));

/** 疑問文の最後に足される、語尾を上げる音の長さ（エンジンの決まり）。 */
const UPSPEAK = 0.15;

/**
 * 音の並びと時刻。エンジンと同じく、音ごとの長さ（間を含む）を話す速さで割り、フレーム単位に丸めて積む。
 * 疑問文（is_interrogative）は、最後に語尾を上げる音が足される（upspeak が true の時）。
 */
export function segmentsOf(query: AudioQuery, upspeak = true): Segment[] {
  const speed = query.speedScale || 1;
  const out: Segment[] = [];
  let t = 0;
  const push = (phoneme: string, seconds: number, kind: Segment['kind'], phrase: number) => {
    const length = frames(seconds, speed) * FRAME;
    if (length <= 0) return;
    out.push({ start: t, end: t + length, phoneme, kind, phrase });
    t += length;
  };
  push('pau', query.prePhonemeLength, 'silence', -1);
  query.accent_phrases.forEach((phrase, index) => {
    for (const mora of phrase.moras) {
      if (mora.consonant && mora.consonant_length) push(mora.consonant, mora.consonant_length, 'consonant', index);
      push(mora.vowel, mora.vowel_length, 'vowel', index);
    }
    const last = phrase.moras.at(-1);
    if (upspeak && phrase.is_interrogative && last && !['N', 'cl'].includes(last.vowel)) push(last.vowel, UPSPEAK, 'vowel', index);
    if (phrase.pause_mora) {
      const scale = query.pauseLengthScale ?? 1;
      const length = query.pauseLength ?? phrase.pause_mora.vowel_length;
      push('pau', length * scale, 'pause', -1); // 間も、話す速さで縮む（エンジンと同じ。実際の音声の長さと照らして確かめた）
    }
  });
  push('pau', query.postPhonemeLength, 'silence', -1);
  return out;
}

export function durationOf(segments: readonly Segment[]): number {
  return segments.at(-1)?.end ?? 0;
}

/** 母音ごとの口の開き（0〜1）。 */
const OPEN: Record<string, number> = { a: 1, o: 0.8, e: 0.7, i: 0.45, u: 0.4, N: 0.25, A: 0.5, I: 0.25, U: 0.2, E: 0.35, O: 0.4 };

/**
 * 口の動き。[始まり, 終わり, 開き] を並べた平らな配列（記録を小さくするため）。
 * 母音の間だけ開き、子音・っ・間では閉じる。秒は小数3桁に丸める。
 */
export function mouthTrack(segments: readonly Segment[]): number[] {
  const out: number[] = [];
  for (const seg of segments) {
    if (seg.kind !== 'vowel') continue;
    const open = OPEN[seg.phoneme] ?? 0;
    if (open <= 0) continue;
    out.push(round3(seg.start), round3(seg.end), open);
  }
  return out;
}

/** 字幕の1かたまり。start〜end のあいだに、text が1文字ずつ出る。 */
export interface Phrase {
  text: string;
  start: number;
  end: number;
}

/**
 * 表示用の文を、音声の間（ま）で区切られたかたまりに合わせる。
 * かたまりの数と、音声の中の間で区切った数が同じなら、それぞれの時刻を使う（aligned: true）。
 * 合わなければ、話している時間全体に、文字を均等に割り振る（aligned: false）。
 */
export function phrasesOf(display: string, segments: readonly Segment[]): { phrases: Phrase[]; aligned: boolean } {
  const groups: { start: number; end: number }[] = [];
  let current: { start: number; end: number } | null = null;
  for (const seg of segments) {
    if (seg.kind === 'pause') {
      if (current) groups.push(current);
      current = null;
    } else if (seg.kind !== 'silence') {
      if (current) current.end = seg.end;
      else current = { start: seg.start, end: seg.end };
    }
  }
  if (current) groups.push(current);
  const chunks = splitPhrases(display);
  if (groups.length > 0 && chunks.length === groups.length) {
    return { phrases: chunks.map((text, i) => ({ text, start: round3(groups[i]!.start), end: round3(groups[i]!.end) })), aligned: true };
  }
  const start = groups[0]?.start ?? 0;
  const end = groups.at(-1)?.end ?? durationOf(segments);
  return { phrases: [{ text: display, start: round3(start), end: round3(end) }], aligned: false };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** WAV の長さ（秒）を、ヘッダから求める。 */
export function wavSeconds(bytes: Uint8Array): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let byteRate = 0;
  for (let offset = 12; offset + 8 <= bytes.byteLength; ) {
    const id = String.fromCharCode(...bytes.subarray(offset, offset + 4));
    const size = view.getUint32(offset + 4, true);
    if (id === 'fmt ') byteRate = view.getUint32(offset + 16, true);
    if (id === 'data') return byteRate > 0 ? Math.min(size, bytes.byteLength - offset - 8) / byteRate : 0;
    offset += 8 + size + (size % 2);
  }
  return 0;
}
