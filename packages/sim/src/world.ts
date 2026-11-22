// 真の状態。ここにある型と値は sim と server（進行役）だけが触る。
// エージェントへ渡るのは observe.ts の buildObservation が作る観測だけ。

import type { BondView, CastCounts, Divined, Role } from '../../protocol/src/index.ts';

export type PlayerId = string;

export type PlayerStatus = 'awake' | 'asleep' | 'sent_home';

export interface PlayerTruth {
  id: PlayerId;
  name: string;
  role: Role;
  persona: string;
  /** 遊び方の癖。本人の観測にだけ入る。 */
  style: string;
  /** 本人から見た、ほかの人との間柄（親密度）。本人の観測にだけ入る。 */
  bonds?: BondView[];
  /** awake: 起きている / asleep: ずんだ餅になった（内部の名前は前の題材のなごり） / sent_home: クビになった。起きている人だけが動き、会議に出る。 */
  status: PlayerStatus;
  /** 本人が見聞きしたこと。本人の観測にだけ入る。 */
  facts: string[];
  /** 占い師だけ: これまでに占った結果（古い順）。本人の観測にだけ入る。 */
  divined?: Divined[];
  /** 狐だけ（横取りに仕込みの条件がある試合）: 自分の仕込みの進み。本人の観測にだけ入る。 */
  foxWork?: { done: number; need: number };
}

export interface SpokenLine {
  round: number;
  speakerId: PlayerId;
  text: string;
}

export type Ballot = PlayerId | 'skip';

export interface MeetingOutcome {
  /** 票数の多い順。同数は席順。棄権は target = 'skip'。 */
  tally: { target: Ballot; count: number }[];
  /** クビにする人。いなければ null。 */
  ejectedId: PlayerId | null;
  /** ejected: 追放成立 / tie: 最多が同数 / too_few: 最多が1票以下 / skip_wins: 棄権が最多以上 */
  verdict: 'ejected' | 'tie' | 'too_few' | 'skip_wins';
  /** 誰が誰に入れたか（投票のあとで全員に明かす）。集計だけの時は無い。 */
  ballots?: Readonly<Record<PlayerId, Ballot>>;
}

export interface MeetingState {
  /** 何回目の集会か（1 始まり）。 */
  index: number;
  /** 全員に告知される、会議が開かれた理由。 */
  reason: string;
  reporterId: PlayerId;
  /** 来ていない人（出席を見れば全員に分かる）。 */
  absent: { id: PlayerId; status: 'asleep' | 'sent_home' }[];
  /** 出席者の席順。全員が見ている。 */
  seats: PlayerId[];
  /** 1 始まり。 */
  round: number;
  phase: 'speak' | 'vote' | 'done';
  /** この巡でまだ話していない人。先頭が次の話者。 */
  queue: PlayerId[];
  transcript: SpokenLine[];
  outcome: MeetingOutcome | null;
}

export interface MeetingConfig {
  maxRounds: number;
  sayTargetChars: number;
  sayMaxChars: number;
}

export const DEFAULT_MEETING_CONFIG: MeetingConfig = {
  maxRounds: 2,
  sayTargetChars: 60,
  sayMaxChars: 80,
};

export interface World {
  seed: number;
  config: MeetingConfig;
  players: PlayerTruth[];
  /** 頭脳を持つ参加者の、全員が知っている並び（名簿順）。 */
  roster: PlayerId[];
  meeting: MeetingState;
  /** これまでの集会の経過。全員に公開された内容だけを書く。 */
  history: string[];
  /** 観戦者とログのための正解。エージェントには渡さない。 */
  truth: {
    nibblerId: PlayerId;
    victimId: PlayerId;
    deedTime: string;
    deedRoom: string;
    /** 時刻ごとの居場所。timeline[playerId][slot] */
    timeline: Record<PlayerId, string[]>;
  };
}

/** ルールに合わない行動。message は行動した本人の入力だけから作る（他人の秘密を混ぜない）。 */
export class RuleViolation extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'RuleViolation';
    this.code = code;
  }
}

/** 会議のルールが必要とする部分。会議だけの版でも、歩き回る版でも同じ関数を使う。 */
export type MeetingWorld = Pick<World, 'seed' | 'config' | 'players' | 'roster' | 'meeting' | 'history'>;

export function playerById(world: Pick<World, 'players'>, id: PlayerId): PlayerTruth {
  const player = world.players.find((p) => p.id === id);
  if (!player) throw new Error(`知らないプレイヤー: ${id}`);
  return player;
}

/** この試合の顔ぶれ（役職ごとの人数）。全員に公開する。誰がどの役職かは入らない。 */
export function castOf(world: Pick<World, 'players'> & { roam?: { foxSteps?: number; divineSeconds?: number } }): CastCounts & { foxes: number; seers: number } {
  const foxes = world.players.filter((p) => p.role === 'fox').length;
  // 狐の横取りの条件（自分の仕込みの工程の数）も、全員が知っている決まり（2026-11-21 から）
  const foxSteps = foxes > 0 ? (world.roam?.foxSteps ?? 0) : 0;
  const seers = world.players.filter((p) => p.role === 'seer').length;
  // 占うのに相手のそばにいる秒数も、全員が知っている決まり（2026-11-21 夜から）
  const divineSeconds = seers > 0 ? (world.roam?.divineSeconds ?? 0) : 0;
  return {
    total: world.players.length,
    nibblers: world.players.filter((p) => p.role === 'nibbler').length,
    madmen: world.players.filter((p) => p.role === 'madman').length,
    foxes,
    seers,
    ...(foxSteps > 0 ? { foxSteps } : {}),
    ...(divineSeconds > 0 ? { divineSeconds } : {}),
  };
}

export function nameOf(world: Pick<World, 'players'>, id: PlayerId): string {
  return playerById(world, id).name;
}

/** 文字数は見た目の1文字（コードポイント）で数える。 */
export function charCount(text: string): number {
  return [...text].length;
}

/** 秒数を 分:秒 の形にする。 */
export function clockText(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}

/** クビになって「狐だった」と全員に知らされた狐の人数（1人以上の時だけ入れる。観測の foxesOut）。 */
export function foxesOutOf(world: { players: readonly PlayerTruth[] }): { foxesOut?: number } {
  const n = world.players.filter((p) => p.role === 'fox' && p.status === 'sent_home').length;
  return n > 0 ? { foxesOut: n } : {};
}
