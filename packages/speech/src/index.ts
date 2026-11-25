// 発言を音声にするための部品（読みの整形、音声の中の時刻、上映用の記録の形）。
// ここにある関数は、通信もファイルの読み書きもしない（この公開版には、音声合成エンジンにつなぐ部分は入れていない）。

export { BREAK, displayText, readClock, splitPhrases, toReading } from './reading.ts';
export type { ReadingRule } from './reading.ts';
export { durationOf, FRAME, mouthTrack, phrasesOf, segmentsOf, wavSeconds } from './timing.ts';
export type { AccentPhrase, AudioQuery, Mora, Phrase, Segment } from './timing.ts';

import type { Phrase } from './timing.ts';

/** 人狼が人をずんだ餅に変える直前の、決めぜりふ（差し込みの間に、人狼の声で言う）。 */
export const CUTIN_LINE = 'ずんだ餅に、なぁれ！';

/** 発言に付けた音声。上映用の付け足しで、試合の記録そのものには入っていない。 */
export interface SpeechClip {
  /** 何番目の発言か（記録の中の speak の通し番号、0 始まり）。key のある音声では -1。 */
  speak: number;
  /**
   * 集会の発言でない音声: talk:<n>（朝礼・日記・感想会の n 番目）/ chat:<n>（見回りの間の声の n 番目）/
   * cutin:<n>（n 番目に餅に変えた人狼の決めぜりふ）/ nar:<場面>:<n>（案内役の言葉）/ cue:<キー>（試合の場面の中の案内役の一言）。
   * text が今の言葉と同じ時だけ使う（案内を書き直したら、古い音声は使わない）。
   */
  key?: string;
  /** 音声にした文（字幕に出す形）。key のある音声だけ。 */
  text?: string;
  file: string;
  seconds: number;
  speaker: string;
  /** 声のクレジット（音声合成エンジンと声の名前）。 */
  credit: string;
  /** 声の名前と声色。 */
  voice?: string;
  /** エンジンに渡した読み用の文。 */
  reading?: string;
  /** 口の開き。[始まり, 終わり, 開き(0〜1)] の並び（秒は音声の頭から）。 */
  mouth?: number[];
  /** 字幕のかたまりと、それを話している時刻。 */
  phrases?: Phrase[];
}

/** 試合の発言の音声の一覧（speech.json）の形。version 1 は、声が1つで、口と字幕の時刻が無い形。 */
export interface SpeechTimeline {
  version: 1 | 2;
  engine: string;
  /** 使った声のクレジット（重なりなし）。version 1 には無い。 */
  credits?: string[];
  clips: SpeechClip[];
}

/** 登場人物ごとの声（content/speech/voices.json）。 */
export interface VoiceCast {
  /** credit は、決められた書き方のある声だけに書く。 */
  voices: Record<string, { character: string; style: number; styleName: string; pitch?: number; speed?: number; credit?: string }>;
  /** 句読点の間の長さの倍率（エンジンの pauseLengthScale）。 */
  pause?: number;
  speed?: number;
}

/** speech.json に書かれたクレジット。古い形（version 1）は、音声ごとのクレジットから集める。 */
export function creditsOf(timeline: SpeechTimeline | null): string[] {
  if (!timeline) return [];
  if (timeline.credits) return timeline.credits;
  return [...new Set(timeline.clips.map((clip) => clip.credit))];
}

/** 口の開き（0〜1）。local は音声の頭からの秒。開いている音の端は、少しなめらかにする。 */
export function mouthAt(mouth: readonly number[], local: number): number {
  for (let i = 0; i + 2 < mouth.length; i += 3) {
    const start = mouth[i]!;
    const end = mouth[i + 1]!;
    if (local < start - 0.03) return 0;
    if (local <= end + 0.03) {
      const open = mouth[i + 2]!;
      const edge = Math.min(1, (local - (start - 0.03)) / 0.05, (end + 0.03 - local) / 0.05);
      return open * Math.max(0, edge);
    }
  }
  return 0;
}

/**
 * 字幕で、いま何文字目まで出すか。phrases があれば、そのかたまりを話している間に1文字ずつ出し、
 * 話し終えたかたまりは全部出す。無ければ spoken 秒かけて全体を出す。
 */
export function revealedChars(total: number, local: number, phrases: readonly Phrase[] | undefined, spoken: number): number {
  if (!phrases || phrases.length === 0) return Math.ceil(total * Math.min(1, Math.max(0, local / Math.max(0.3, spoken))));
  let shown = 0;
  for (const phrase of phrases) {
    const length = [...phrase.text].length;
    if (local >= phrase.end) shown += length;
    else if (local > phrase.start) shown += Math.ceil(length * ((local - phrase.start) / Math.max(0.05, phrase.end - phrase.start)));
    else break;
  }
  return Math.min(total, shown);
}
