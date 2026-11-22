// 試合の記録から、上映の時間軸を作る。
// 見回りは記録の時刻のまま流し、集会は発言の長さ（音声があればその長さ）に合わせて並べる。

import type { MatchEvent, MatchLog } from '../../server/src/match-core.ts';
import { calloutsOf } from '../../server/src/narration.ts';
import type { Callout } from '../../server/src/narration.ts';
import type { DeviceKind } from '../../protocol/src/index.ts';
import type { MapDefinition } from '../../sim/src/index.ts';
import { CUTIN_LINE, displayText } from '../../speech/src/index.ts';
import type { SpeechClip, SpeechTimeline } from '../../speech/src/index.ts';

export type { SpeechClip, SpeechTimeline };

export type Frame = NonNullable<MatchLog['roam']>['frames'][number];
type EventOf<T extends MatchEvent['type']> = Extract<MatchEvent, { type: T }>;

export interface RoamSegment {
  kind: 'roam';
  start: number;
  end: number;
  round: number;
  /** この見回りが始まった時の、試合の中の時計（秒）。 */
  clock0: number;
  frames: Frame[];
  /** 最後の声が鳴り終わるのを待つため、絵を止めている秒数（見回りの終わり）。 */
  held?: number;
  /**
   * 声が詰まっている所で、絵をゆっくり流した分の対応。見回りの始まりからの「試合の中の秒, 上映の秒」を交互に並べる。
   * 無ければ、試合の中の時計のままの速さ。showTimeOf / roamClockAt で使う。
   */
  warp?: number[];
}

export interface MeetingSegment {
  kind: 'meeting';
  start: number;
  end: number;
  info: EventOf<'meeting_start'>;
  result: EventOf<'meeting_end'> | null;
  /** 鐘と告知が終わって、話し合いが始まる時刻。 */
  talkStart: number;
  /** 投票が始まる時刻、票が開く時刻、結果が出る時刻。 */
  voteStart: number;
  revealAt: number;
  resultAt: number;
  votes: EventOf<'vote'>[];
}

export interface EndingSegment {
  kind: 'ending';
  start: number;
  end: number;
  info: EventOf<'game_over'>;
}

/** 冒頭の、登場人物の紹介。 */
export interface IntroSegment {
  kind: 'intro';
  start: number;
  end: number;
}

export type Segment = IntroSegment | RoamSegment | MeetingSegment | EndingSegment;

/** 上映の時間軸に置いた出来事。 */
export interface Cue {
  at: number;
  end: number;
  event: MatchEvent;
  /** speak の通し番号（speak のときだけ）。 */
  speakIndex?: number;
  clip?: SpeechClip;
  /** chat のときだけ: 声を流すか（前の声と重なりすぎる声は、ふきだしだけにする）。 */
  voiced?: boolean;
}

/** 仕込みの進み具合が変わった時刻。 */
export interface ProgressPoint {
  at: number;
  done: number;
  total: number;
  /** この時刻に、仕込みが1つ終わったか（見回りの始まりの数え直しでは false）。 */
  bump: boolean;
}

/** 困りごと（あかりが消えた・かまどの焚きすぎ）が続いていた間。 */
export interface TroubleSpan {
  what: 'lights' | 'crisis';
  by: string;
  start: number;
  end: number;
  /** かまどの猶予（秒）。あかりは null。 */
  seconds: number | null;
  /** fixed: 直した / meeting: 集会が始まって片づいた / timeout: 間に合わなかった / over: 試合が終わった */
  how: 'fixed' | 'meeting' | 'timeout' | 'over';
  fixedBy: string[];
}

/** 部屋の戸が閉まっていた間。 */
export interface ShutSpan {
  room: string;
  by: string;
  start: number;
  end: number;
}

/** 床下の抜け道を通っていた間。 */
export interface SneakSpan {
  seat: number;
  by: string;
  start: number;
  end: number;
  from: { x: number; y: number; room: string };
  /** 出た所。集会が始まって途中で出てきた時は null。 */
  to: { x: number; y: number; room: string } | null;
  seenIn: string[];
  seenOut: string[];
}

/**
 * 工房の道具（見取り図の盤・名札かけ・防犯カメラの画面）を見ていた間。
 * 見えたもの（counts・tags・seen）は、見終わった時の記録から入る（途中でやめた時は、防犯カメラの seen だけ）。
 */
export interface LookSpan {
  seat: number;
  by: string;
  device: DeviceKind;
  start: number;
  end: number;
  aborted: boolean;
  counts?: Record<string, number>;
  tags?: { name: string; status: 'awake' | 'asleep' | 'sent_home' }[];
  seen?: { camera: string; names: string[] }[];
}

/** 妖精が人をずんだ餅に変える直前の、見せ場の差し込み（役職を見せている時だけ出す）。 */
export interface Cutin {
  at: number;
  /** 差し込みが終わる時刻（このすぐあとに、餅に変わる）。 */
  end: number;
  /** 餅にした妖精と、餅にされた人。妖精2人が同じ瞬間に変えた時は、2組になる（1つの差し込みに並べる）。 */
  pairs: { by: string; target: string }[];
  /** 妖精の決めぜりふの音声（あれば。2組の時は、先の妖精の声）。 */
  clip?: SpeechClip;
}

const CUTIN_SECONDS = 2.1;

/** 試合の場面の中で、案内役が言う一言を、上映の時間軸に置いたもの。 */
export interface ShowCallout {
  at: number;
  end: number;
  key: string;
  text: string;
  /** 役職を明かす一言（役職を見せている時だけ鳴らして出す）。 */
  secret: boolean;
  /** false: 前の声と重なりすぎるので、出さない。 */
  voiced: boolean;
  clip?: SpeechClip;
}

export interface Show {
  log: MatchLog;
  segments: Segment[];
  cues: Cue[];
  total: number;
  /** 開店までの時間（秒）。 */
  opening: number;
  /** 仕込み・困りごと・戸・抜け道の移り変わり（どれも上映の時刻の順）。古い記録では空。 */
  progress: ProgressPoint[];
  troubles: TroubleSpan[];
  shuts: ShutSpan[];
  sneaks: SneakSpan[];
  /** 工房の道具を見ていた間（上映の時刻の順）。古い記録では空。 */
  looks: LookSpan[];
  /** 餅に変える直前の差し込み（上映の時刻の順）。 */
  cutins: Cutin[];
  /** 案内役の一言（上映の時刻の順）。 */
  callouts: ShowCallout[];
}

export const INTRO_SECONDS = 7;
// 集会の区切りの長さ。案内役の一言があれば、それが言い終わるまで伸ばす（無言の時間を作らないため、これより長い間は置かない）
const BELL_SECONDS = 3;
const VOTE_THINK_SECONDS = 1.8;
// 2026-11-19: 開票とクビの場面に、声の無い間が 1.7秒・3.4秒あった（無言の時間を作らない）ので詰めた
const VOTE_REVEAL_SECONDS = 2.0;
const RESULT_SECONDS = 3.2;
/**
 * クビの場面の時刻（結果が出てからの秒）。stamp: はんこ「クビ」（音も鳴らす） / walk: 風呂敷を背負って出ていく（walkSeconds かけて） /
 * verdict: 妖精だったかどうかの札 / note: 観戦者にだけ、本当の役職。seconds は場面の短いほうの長さ（案内役の一言が長ければ、それに合わせて伸びる）。
 */
export const FIRED = { stamp: 0.3, walk: 0.8, walkSeconds: 1.3, verdict: 1.0, note: 1.35, seconds: 2.2 } as const;
const ENDING_SECONDS = 12;
/** 発言の音声のあとの余白と、次の発言までの間。 */
const SPEAK_PAD = 0.2;
const GAP = 0.2;
/** 見回りの中の出来事を、画面でどのくらいの間あつかうか（秒）。 */
/** 占いの瞬間の絵（光・輪・結果の札）の、もとの長さ。案内役が結果を言い終わるのが遅い時は、札だけ長く出す（cue.end を延ばす）。 */
export const DIVINE_CUE_SECONDS = 2.6;
const ROAM_CUE_SECONDS: Partial<Record<MatchEvent['type'], number>> = { decide: 3.2, nap: 2.4, nap_failed: 3, task: 1.8, sabotage: 4.5, fixed: 3.2, door_open: 1.2, sneak: 1.3, bell: 1, look: 2, divine: DIVINE_CUE_SECONDS };

/**
 * 見回りの間の声は、前の声と重ならないよう、終わるのを待ってから流す。待ちがこの秒数を超える声は、ふきだしだけにする。
 * 見回りの最後の声（見つけた時の叫びなど）が終わるまでは、集会へ移らずに、絵を止めて待つ。
 * ただし、見回りが終わってから CHAT_LATE_MAX 秒より後に始まる声は、ふきだしだけにする（待ちを長くしすぎない）。
 */
const CHAT_DELAY_MAX = 3;
/** 案内役の一言は、もう少し待ってでも言う。 */
const CALLOUT_DELAY_MAX = 4.5;
const CHAT_LATE_MAX = 1.5;
const CHAT_GAP = 0.15;
/** 声が詰まっている間に、絵をゆっくり流す時の、いちばん遅い速さ（1 がそのままの速さ）。 */
export const SLOW_SPEED = 0.7;
/** 雑談の声を、言ってから鳴らすまでに、世界が進んでよい秒数（試合の中の時間）。 */
const CHAT_WAIT_MAX = 1;
/** 仲よし（親密度4以上）どうしのやりとりの返事は、もう少し待ってでも鳴らす（2026-11-19、同じ瞬間に話し合った仲よしの返事が、ふきだしだけになっていた）。 */
const FRIEND_WAIT_MAX = 4;
/** 返事の始まりの言葉（返している相手の声が鳴っていない時は、その返事を鳴らさない）。 */
const REPLY_OPENER = /^(うん|ええ|はい|そうそう|そうだね|そうですね|そうですわね|そっか|なるほど|ありがと|了解|わかった|分かった|たしかに|確かに|いいよ|だよね|でしょ|ほんとそれ)/;

/** 見回りの始まりからの試合の中の秒 → 上映の秒。warp が無ければ、そのまま。 */
function warpForward(warp: readonly number[] | undefined, local: number): number {
  if (!warp || warp.length < 4) return local;
  for (let i = 2; i < warp.length; i += 2) {
    const c1 = warp[i] as number;
    if (local > c1) continue;
    const c0 = warp[i - 2] as number;
    const s0 = warp[i - 1] as number;
    const s1 = warp[i + 1] as number;
    return c1 - c0 < 1e-9 ? s1 : s0 + ((local - c0) * (s1 - s0)) / (c1 - c0);
  }
  return (warp.at(-1) as number) + (local - (warp.at(-2) as number));
}

/** 見回りの始まりからの上映の秒 → 試合の中の秒（warpForward の逆）。 */
function warpBack(warp: readonly number[] | undefined, local: number): number {
  if (!warp || warp.length < 4) return local;
  for (let i = 2; i < warp.length; i += 2) {
    const s1 = warp[i + 1] as number;
    if (local > s1) continue;
    const c0 = warp[i - 2] as number;
    const s0 = warp[i - 1] as number;
    const c1 = warp[i] as number;
    return s1 - s0 < 1e-9 ? c1 : c0 + ((local - s0) * (c1 - c0)) / (s1 - s0);
  }
  return (warp.at(-2) as number) + (local - (warp.at(-1) as number));
}

/** 見回りの中の、試合の時計の時刻 → 上映の時刻。 */
export function showTimeOf(segment: RoamSegment, clock: number): number {
  return segment.start + warpForward(segment.warp, clock - segment.clock0);
}

/** 上映の時刻 → その見回りの中の、試合の時計の時刻。 */
export function roamClockAt(segment: RoamSegment, time: number): number {
  return segment.clock0 + warpBack(segment.warp, time - segment.start);
}

/** 発言を読むのにかかる時間の目安（音声が無いとき）。 */
export function readingSeconds(text: string): number {
  return Math.max(2.6, [...text].length * 0.15 + 1.2);
}

/** 2人の親しさ（どちらから見ても高いほう。間柄を渡していない古い試合は 0）。 */
export function closenessOf(log: MatchLog): (a: string, b: string) => number {
  const level = (from: string, to: string) => log.players.find((p) => p.name === from)?.bonds?.find((bond) => bond.name === to)?.level ?? 0;
  return (a, b) => Math.max(level(a, b), level(b, a));
}

export function buildShow(log: MatchLog, speech: SpeechTimeline | null): Show {
  const frames = log.roam?.frames ?? [];
  const segments: Segment[] = [];
  const cues: Cue[] = [];
  const clips = new Map((speech?.clips ?? []).filter((clip) => clip.key === undefined).map((clip) => [clip.speak, clip]));
  const closeness = closenessOf(log);
  const keyed = new Map((speech?.clips ?? []).filter((clip) => clip.key?.startsWith('chat:') || clip.key?.startsWith('cutin:') || clip.key?.startsWith('cue:')).map((clip) => [clip.key as string, clip]));
  let chatIndex = 0;
  // 案内役の一言（出来事の番号ごと）と、その長さ
  const callouts: ShowCallout[] = [];
  const calloutsAt = new Map<number, Callout[]>();
  for (const callout of calloutsOf(log)) calloutsAt.set(callout.event, [...(calloutsAt.get(callout.event) ?? []), callout]);
  const voiceOf = (callout: Callout) => {
    const found = keyed.get(`cue:${callout.key}`);
    const clip = found && found.text === displayText(callout.text) ? found : undefined;
    return { clip, length: clip ? clip.seconds + 0.2 : readingSeconds(callout.text) };
  };
  /** 集会の中の一言を、決まった時刻に置く。返すのは言い終わる時刻（一言が無ければ null）。 */
  const meetingCallout = (event: number, prefix: string, at: number): number | null => {
    const callout = calloutsAt.get(event)?.find((c) => c.key.startsWith(prefix));
    if (!callout) return null;
    const { clip, length } = voiceOf(callout);
    const start = at + callout.delay;
    callouts.push({ at: start, end: start + length, key: callout.key, text: callout.text, secret: callout.secret, voiced: true, ...(clip ? { clip } : {}) });
    return start + length;
  };
  /** 集会の区切りの一言の長さ（区切りを伸ばすため、前もって知る）。 */
  const meetingLength = (event: number, prefix: string): number => {
    const callout = calloutsAt.get(event)?.find((c) => c.key.startsWith(prefix));
    return callout ? callout.delay + voiceOf(callout).length + 0.05 : 0;
  };
  /** 見回りの中の声（登場人物の声と、案内役の一言）。見回りが終わる時に、まとめて並べる。talk: 聞いている人がいる声（ひとりごとでない）。 */
  // needs: この声が鳴った時だけ言う一言（その声への案内役のツッコミ・補足）。once: 同じ印の一言は、試合で最初に鳴った1つだけ。
  // follow: この声のあとに言いたい一言の印（まだ使っていなければ、この声を先に鳴らす）
  // spot: 占いの瞬間（その結果を言う案内役の一言に付ける）。占いがもう起きたのに、まだ言い始めていない雑談は、ふきだしだけにして、この一言を先に流す
  let pending: { chat: Cue | null; callout: ShowCallout | null; said: number; length: number; talk: boolean; needs?: Cue; once?: string; follow?: string[]; spot?: number }[] = [];
  /** 占いの瞬間と、その結果を言う案内役の一言（見回りが終わる時に、札を出しておく長さを合わせる）。 */
  let divineTold: { cue: Cue; callout: ShowCallout }[] = [];
  /** もう鳴らした一言の印（試合を通して）。 */
  const usedOnce = new Set<string>();
  /** 見回りが始まった時の、各一覧の長さ（この見回りの中で足したものを、あとで時刻を引きのばすため）。 */
  let mark = { cues: 0, callouts: 0, progress: 0, troubles: 0, shuts: 0, sneaks: 0, looks: 0 };
  /**
   * 見回りの声を並べ、声が詰まっている所では、絵をゆっくり流す（時刻を引きのばす）。
   * 言った順に、前の声が鳴り終わるのを待ってから次の声を流す。前の声が鳴っている間は、世界を SLOW_SPEED まで遅くして、
   * 次の声を言った瞬間が、前の声の終わりに来るようにする。遅くしても間に合わない声は、試合の中の時間で CHAT_WAIT_MAX 秒まで待たせ、
   * それより待つ声は、ふきだしだけにする。引きのばすのは、聞いている人がいる声（雑談）と案内役の一言だけ。ひとりごとは、そのままの速さで入る時だけ鳴らす。
   * 同じ瞬間に何人も話した時は、いま聞こえた声への返事（声が聞こえ合っている人どうし・名前を呼び合っている声）を先に流す（会話としてつながるように）。
   * 餅に変わる瞬間の前には、妖精の見せ場（差し込み）が入るので、鳴っている声が言い終わるまで、絵をゆっくりにして待つ。
   * 返すのは、試合の中の秒と上映の秒の対応（見回りの始まりからの秒を、交互に並べたもの）。
   */
  const scheduleRoam = (round: RoamSegment): number[] => {
    type Voice = (typeof pending)[number] & { lin: number; nap: false };
    type Item = { lin: number; nap: true } | Voice;
    const naps: Item[] = cues.slice(mark.cues).filter((cue) => cue.event.type === 'nap').map((cue) => ({ lin: cue.at, nap: true }));
    const voices: Item[] = pending.map((p) => ({ ...p, lin: p.said, nap: false }));
    const items = [...naps, ...voices].sort((a, b) => a.lin - b.lin);
    const warp = [0, 0];
    let lin0 = round.start;
    let show0 = round.start;
    let free = -Infinity;
    const knot = (lin: number, show: number) => {
      warp.push(lin - round.start, show - round.start);
      lin0 = lin;
      show0 = show;
    };
    // いま鳴った声（話した人と、呼びかけた相手と、聞こえた人）。同じ瞬間の声の中で、どれを先に流すかに使う
    const heardNow: { lin: number; speaker: string; called: string[]; heard: string[] }[] = [];
    const called = (say: string, speaker: string) => log.seats.filter((name) => name !== speaker && say.includes(name));
    const score = (item: Item): number => {
      if (item.nap) return 100;
      if (item.callout) return 50;
      const event = (item.chat as Cue).event as EventOf<'chat'>;
      // 仲よし（親密度4以上）に聞こえるように呼びかけている声を、同じ瞬間の声の中で先に流す
      const friend = Math.max(0, ...called(event.say, event.speaker).filter((name) => event.heard.includes(name)).map((name) => closeness(event.speaker, name)));
      // 案内役がツッコミ・補足を入れたい声は、先に鳴らす（まだその一言を使っていなければ）
      const wanted = (item as Voice).follow?.some((key) => !usedOnce.has(key)) ? 6 : 0;
      // 上映の編集で、同じ瞬間の声の中の順番を決めた声（edits.json の keep の lead）
      if (event.keep) return 1000 + event.keep;
      // 仲よしの呼びかけへの返事は、ほかの呼びかけより先に（やりとりが途中で切れないように）
      return baseScore(item) + (friend >= 4 ? friend - 2 : 0) + (answersFriend(item) ? 3 : 0) + wanted;
    };
    /** いま鳴った仲よしの声への返事か（仲よしに呼ばれた / 仲よしの名前を呼んで答えている）。 */
    const answersFriend = (item: Voice): boolean => {
      if (!item.chat) return false;
      const event = item.chat.event as EventOf<'chat'>;
      const names = called(event.say, event.speaker);
      return heardNow.some((h) => item.lin - h.lin <= 8 && closeness(event.speaker, h.speaker) >= 4 && (h.called.includes(event.speaker) || names.includes(h.speaker)) && event.heard.includes(h.speaker));
    };
    /** 仲よしとのやりとり（返事か、仲よしに聞こえるように名前を呼んで話しかけている声）。 */
    const friendReply = (item: Voice): boolean => {
      if (!item.chat) return false;
      const event = item.chat.event as EventOf<'chat'>;
      return answersFriend(item) || called(event.say, event.speaker).some((name) => event.heard.includes(name) && closeness(event.speaker, name) >= 4);
    };
    const baseScore = (item: Item): number => {
      if (item.nap) return 100;
      if (item.callout) return 50;
      const event = (item.chat as Cue).event as EventOf<'chat'>;
      const recent = heardNow.filter((h) => item.lin - h.lin <= 20);
      const names = called(event.say, event.speaker);
      let points = item.talk ? 1 : 0;
      if (names.length > 0) points += 1;
      // いま聞こえた声の主に返事をしている / いま聞こえた声で呼ばれた人が答えている
      if (recent.some((h) => names.includes(h.speaker))) points += 3;
      if (recent.some((h) => h.called.includes(event.speaker))) points += 3;
      // 名前を呼ばなくても、いま鳴った声を聞いた人が、その声の主に聞こえるように話していれば、返事とみなす
      if (recent.some((h) => h.heard.includes(event.speaker) && event.heard.includes(h.speaker))) points += 3;
      return points;
    };
    // 上映の編集で残すと決めた声（keep）が言い終わる時刻。次の見せ場（餅に変わる瞬間）を、ここまで待たせる
    let holdNap = -Infinity;
    const voice = (item: Voice, nextNap: Item | undefined, spots: readonly number[] = []): boolean => {
      // 一言: 付いている声が鳴らなかった時と、同じ印をもう使った時は言わない
      if (item.callout && item.needs && !item.needs.voiced) return false;
      if (item.callout && item.once && usedOnce.has(item.once)) return false;
      // 「うん、」「ありがと」などで始まる返事は、返している相手の声が鳴っていなければ鳴らさない（前が分からない返事だけが聞こえるのを避ける。
      // 上映の編集で残すと決めた声（edits.json の keep）と、その声へのツッコミは、待たせてでも鳴らす。mute の声は鳴らさない
      if (item.chat && (item.chat.event as EventOf<'chat'>).mute) return false;
      // 妨害の知らせ（誰があかりを消したか・かまどを焚きすぎにしたか）も、観戦する人が見逃せないので、待たせてでも鳴らす
      const kept = ((item.chat ?? item.needs)?.event.type === 'chat' && ((item.chat ?? item.needs)?.event as EventOf<'chat'>).keep !== undefined) || (item.callout?.key.startsWith('sab:') ?? false);
      const keptChat = kept && Boolean(item.chat);
      if (item.chat && !kept) {
        const event = item.chat.event as EventOf<'chat'>;
        const answered = heardNow.some((h) => item.lin - h.lin <= 10 && h.speaker !== event.speaker && h.heard.includes(event.speaker) && event.heard.includes(h.speaker));
        if (REPLY_OPENER.test(event.say.replace(/^[…・.。、！!？?\s]+/, '')) && !answered) return false;
      }
      const at = Math.max(item.lin, lin0);
      const natural = show0 + (at - lin0);
      const stretch = item.callout !== null || item.talk;
      let knotLin = at;
      let knotShow = natural;
      let start = natural;
      if (free > natural) {
        if (stretch) {
          // いちばん遅く流しても、前の声が終わった時に、世界はここまで進んでいる
          const linFree = lin0 + (free - show0) * SLOW_SPEED;
          knotLin = Math.max(at, linFree);
          // 残すと決めた声は、次の見せ場より前に言い始める（世界を、いつもの「ゆっくり」より遅くして待たせる）
          if (keptChat && nextNap && nextNap.lin >= at) knotLin = Math.min(knotLin, Math.max(at, nextNap.lin - 0.05));
          knotShow = free;
          start = free;
        } else {
          start = free;
          if (free - natural > CHAT_DELAY_MAX && !kept) return false;
        }
      }
      // 言ってから声になるまでに、世界が進んでしまう秒数
      const late = knotLin + (start - knotShow) - item.lin;
      // 占いの結果を言う一言が待っているのに、占いのあとで言い始めることになる雑談は、ふきだしだけにする
      if (item.chat && !kept && spots.some((spot) => spot <= knotLin + (start - knotShow) + 1e-6)) return false;
      if (!kept && late > (item.callout ? CALLOUT_DELAY_MAX : stretch ? (friendReply(item) ? FRIEND_WAIT_MAX : CHAT_WAIT_MAX) : CHAT_DELAY_MAX) + 1e-9) return false;
      // 次の見せ場が始まるまでに言い終われない声は出さない（見せ場の決めぜりふと重ねない）。
      // 残すと決めた声（妖精が、ねらった相手に声をかける所など）は、見せ場のほうを待たせる。見せ場のあとになってしまう時だけ出さない
      if (keptChat && nextNap && nextNap.lin < knotLin) return false;
      if (!keptChat && nextNap && (nextNap.lin < knotLin || start + item.length + CUTIN_SECONDS + 0.05 > knotShow + (nextNap.lin - knotLin) / SLOW_SPEED)) return false;
      knot(knotLin, knotShow);
      const placed = item.chat ?? item.callout;
      if (placed) {
        placed.at = start;
        placed.end = start + item.length;
      }
      free = start + item.length + CHAT_GAP;
      if (keptChat && nextNap) holdNap = free;
      if (item.callout && item.once) usedOnce.add(item.once);
      if (item.chat) {
        const event = item.chat.event as EventOf<'chat'>;
        heardNow.push({ lin: item.lin, speaker: event.speaker, called: called(event.say, event.speaker), heard: event.heard });
      }
      return true;
    };
    for (let i = 0; i < items.length; ) {
      // 同じ瞬間のもの（餅に変わる瞬間 → 案内役 → 返事になっている声 → 呼びかけ → 雑談 → ひとりごと）
      let j = i;
      while (j < items.length && (items[j] as Item).lin - (items[i] as Item).lin < 1e-6) j++;
      const group = items.slice(i, j);
      const nextNap = items.slice(j).find((other) => other.nap);
      while (group.length > 0) {
        let best = 0;
        for (let k = 1; k < group.length; k++) if (score(group[k] as Item) > score(group[best] as Item)) best = k;
        const [item] = group.splice(best, 1) as [Item];
        if (item.nap) {
          const at = Math.max(item.lin, lin0);
          // 見せ場が始まる前に、鳴っている声が言い終わるようにする
          // 残すと決めた声が鳴っている間は、「ゆっくり」の限りを超えてでも、言い終わるまで待つ
          const show = Math.min(Math.max(show0 + (at - lin0), free + CUTIN_SECONDS + 0.1), Math.max(show0 + (at - lin0) / SLOW_SPEED, holdNap + CUTIN_SECONDS + 0.1));
          holdNap = -Infinity;
          knot(at, show);
          free = Math.max(free, show + 0.3);
          continue;
        }
        const later = group.find((other) => other.nap) ?? nextNap;
        const spots = [...group, ...items.slice(j)].flatMap((other) => (!other.nap && other.callout?.voiced && other.spot !== undefined ? [other.spot] : []));
        if (voice(item, later, spots)) continue;
        if (item.chat) {
          item.chat.voiced = false;
          delete item.chat.clip;
        }
        if (item.callout) {
          item.callout.voiced = false;
          delete item.callout.clip;
        }
      }
      i = j;
    }
    pending = [];
    return warp;
  };

  const voteEvent = new Map<number, number>();
  const endEvent = new Map<number, number>();
  log.events.forEach((event, i) => {
    if (event.type === 'vote' && !voteEvent.has(event.meeting)) voteEvent.set(event.meeting, i);
    if (event.type === 'meeting_end') endEvent.set(event.meeting, i);
  });
  const revealSeconds = (meeting: number) => Math.max(VOTE_REVEAL_SECONDS, meetingLength(endEvent.get(meeting) ?? -1, 'tally:'));
  let cursor = 0;
  if (log.events.some((event) => event.type === 'round_start')) {
    segments.push({ kind: 'intro', start: 0, end: INTRO_SECONDS });
    cursor = INTRO_SECONDS;
  }
  let roam: RoamSegment | null = null;
  let meeting: MeetingSegment | null = null;
  let speakIndex = 0;

  const map = log.roam?.map;
  const progress: ProgressPoint[] = [];
  const troubles: TroubleSpan[] = [];
  const shuts: ShutSpan[] = [];
  const sneaks: SneakSpan[] = [];
  const looks: LookSpan[] = [];
  let trouble: TroubleSpan | null = null;
  let shut: ShutSpan[] = [];
  let under: SneakSpan[] = [];
  let looking: LookSpan[] = [];
  /** 困りごと・閉まった戸・床下にいる人は、集会が始まるか試合が終わると片づく。 */
  const settle = (at: number, how: TroubleSpan['how']) => {
    if (trouble) {
      trouble.end = at;
      trouble.how = how;
      trouble = null;
    }
    for (const span of shut) span.end = at;
    for (const span of under) span.end = at;
    for (const span of looking) {
      span.end = at;
      span.aborted = true;
    }
    shut = [];
    under = [];
    looking = [];
  };

  const closeRoam = (clock: number) => {
    if (!roam) return;
    const round = roam;
    const warp = scheduleRoam(round);
    // 声を並べる前（そのままの速さ）の時刻を、引きのばしたあとの時刻に直す
    const stretched = warp.some((v, i) => i % 2 === 1 && Math.abs(v - (warp[i - 1] as number)) > 1e-9);
    if (stretched) round.warp = warp;
    const shift = (lin: number) => round.start + warpForward(round.warp, lin - round.start);
    for (const cue of cues.slice(mark.cues)) {
      if (cue.event.type === 'chat' && cue.voiced) continue;
      const length = cue.end - cue.at;
      cue.at = shift(cue.at);
      cue.end = cue.at + length;
    }
    for (const c of callouts.slice(mark.callouts)) {
      if (c.voiced) continue;
      const length = c.end - c.at;
      c.at = shift(c.at);
      c.end = c.at + length;
    }
    for (const point of progress.slice(mark.progress)) point.at = shift(point.at);
    for (const span of [...troubles.slice(mark.troubles), ...shuts.slice(mark.shuts), ...sneaks.slice(mark.sneaks), ...looks.slice(mark.looks)]) {
      span.start = shift(span.start);
      if (Number.isFinite(span.end)) span.end = shift(span.end);
    }
    round.end = shift(round.start + Math.max(0, clock - round.clock0));
    // 最後の声が鳴り終わるまで待つ。待ちきれない声は、ふきだしだけにする
    const open = cues.slice(mark.cues).filter((cue) => cue.event.type === 'chat' && cue.voiced);
    const told = callouts.slice(mark.callouts).filter((c) => c.voiced);
    for (const c of told) {
      if (c.at <= round.end + CHAT_LATE_MAX) continue;
      c.voiced = false;
    }
    for (const cue of open) {
      if (cue.at <= round.end + CHAT_LATE_MAX) continue;
      // ふきだしだけにする声は、言った時刻に戻す
      const said = showTimeOf(round, (cue.event as EventOf<'chat'>).t);
      cue.end = said + (cue.end - cue.at);
      cue.at = said;
      cue.voiced = false;
      delete cue.clip;
    }
    // 占いの結果の札は、案内役が結果を言い終わるまで出しておく
    for (const { cue, callout } of divineTold) if (callout.voiced) cue.end = Math.max(cue.end, callout.end - 0.5);
    divineTold = [];
    const held = Math.max(round.end, ...open.filter((cue) => cue.voiced).map((cue) => cue.end), ...told.filter((c) => c.voiced).map((c) => c.end)) - round.end;
    if (held > 0) {
      round.end += held;
      round.held = held;
    }
    cursor = round.end;
    roam = null;
  };

  for (const [index, event] of log.events.entries()) {
    if (event.type === 'round_start') {
      // 試合が集会の結果で終わると、同じ時刻・同じ回の記録が、集会のあと（クビになった人がいない形）でもう1つ残る。
      // 見回りの絵には、集会の前の形だけを使う（鐘のあとに絵を止めている間に、クビになる人が消えないように）
      const own = frames.filter((f) => f.r === event.round);
      roam = { kind: 'roam', start: cursor, end: cursor, round: event.round, clock0: event.t, frames: own.filter((f, i) => i === 0 || f.t > (own[i - 1] as Frame).t + 1e-9) };
      segments.push(roam);
      mark = { cues: cues.length, callouts: callouts.length, progress: progress.length, troubles: troubles.length, shuts: shuts.length, sneaks: sneaks.length, looks: looks.length };
      cues.push({ at: cursor, end: cursor, event });
      if (event.tasks && event.tasks.total > 0) progress.push({ at: cursor, done: event.tasks.done, total: event.tasks.total, bump: false });
    } else if (event.type === 'decide' || event.type === 'nap' || event.type === 'nap_failed' || event.type === 'divine' || event.type === 'task' || event.type === 'sabotage' || event.type === 'fixed' || event.type === 'door_open' || event.type === 'sneak' || event.type === 'bell') {
      const at = roam ? roam.start + (event.t - roam.clock0) : cursor;
      cues.push({ at, end: at + (ROAM_CUE_SECONDS[event.type] ?? 2), event });
      // 案内役の一言（見回りの間の声と同じ列に並べ、重ねない）
      for (const callout of roam ? (calloutsAt.get(index) ?? []) : []) {
        const { clip, length } = voiceOf(callout);
        const said = at + callout.delay;
        const placed: ShowCallout = { at: said, end: said + length, key: callout.key, text: callout.text, secret: callout.secret, voiced: true, ...(clip ? { clip } : {}) };
        callouts.push(placed);
        pending.push({ chat: null, callout: placed, said, length, talk: true, ...(event.type === 'divine' ? { spot: at } : {}) });
        if (event.type === 'divine') divineTold.push({ cue: cues.at(-1) as Cue, callout: placed });
      }
      if (event.type === 'task') {
        if (!event.pretend && event.total > 0) progress.push({ at, done: event.done, total: event.total, bump: true });
      } else if (event.type === 'sabotage') {
        if (event.what === 'door') {
          if (event.room !== null) {
            const span: ShutSpan = { room: event.room, by: event.by, start: at, end: Infinity };
            shut.push(span);
            shuts.push(span);
          }
        } else {
          if (trouble) trouble.end = at;
          trouble = { what: event.what, by: event.by, start: at, end: Infinity, seconds: event.what === 'crisis' ? event.seconds : null, how: 'over', fixedBy: [] };
          troubles.push(trouble);
        }
      } else if (event.type === 'fixed') {
        if (trouble && trouble.what === event.what) {
          trouble.end = at;
          trouble.how = 'fixed';
          trouble.fixedBy = event.by;
          trouble = null;
        }
      } else if (event.type === 'door_open') {
        for (const span of shut) if (span.room === event.room) span.end = at;
        shut = shut.filter((span) => span.room !== event.room);
      } else if (event.type === 'sneak') {
        const hatch = map?.hatches?.find((h) => h.id === event.hatch);
        const here = { x: (hatch?.x ?? 0) + 0.5, y: (hatch?.y ?? 0) + 0.5, room: event.room };
        if (event.phase === 'in') {
          const span: SneakSpan = { seat: log.seats.indexOf(event.by), by: event.by, start: at, end: Infinity, from: here, to: null, seenIn: event.witnesses, seenOut: [] };
          if (hatch && span.seat >= 0) {
            under.push(span);
            sneaks.push(span);
          }
        } else {
          const span = under.find((s) => s.by === event.by);
          if (span) {
            span.end = at;
            span.to = here;
            span.seenOut = event.witnesses;
            under = under.filter((s) => s !== span);
          }
        }
      }
    } else if (event.type === 'look') {
      // 見始めは、カメラの係とできごとの音のために、1つのできごとにする。見終わりは、見ていた間を閉じるだけ
      const at = roam ? roam.start + (event.t - roam.clock0) : cursor;
      if (event.phase === 'start') {
        cues.push({ at, end: at + (ROAM_CUE_SECONDS.look ?? 2), event });
        const span: LookSpan = { seat: log.seats.indexOf(event.agent), by: event.agent, device: event.device, start: at, end: Infinity, aborted: false };
        if (span.seat >= 0) {
          looking.push(span);
          looks.push(span);
        }
      } else {
        const span = looking.find((s) => s.by === event.agent && s.device === event.device);
        if (span) {
          span.end = at;
          span.aborted = event.aborted === true;
          if (event.counts) span.counts = event.counts;
          if (event.tags) span.tags = event.tags;
          if (event.seen) span.seen = event.seen;
          looking = looking.filter((s) => s !== span);
        }
      }
    } else if (event.type === 'chat') {
      const at = roam ? roam.start + (event.t - roam.clock0) : cursor;
      const found = keyed.get(`chat:${chatIndex}`);
      const clip = found && found.text === displayText(event.say) ? found : undefined;
      const length = clip ? clip.seconds + 0.3 : readingSeconds(event.say);
      const cue: Cue = { at, end: at + length, event, ...(clip ? { clip } : {}), voiced: true };
      cues.push(cue);
      if (roam) {
        // この声への案内役の一言（ツッコミ・補足）。声が鳴った時だけ、そのすぐあとに言う
        const follow = (calloutsAt.get(index) ?? []).filter((c) => c.onChat);
        pending.push({ chat: cue, callout: null, said: at, length, talk: event.heard.length > 0, follow: follow.filter((c) => c.lift).map((c) => c.once ?? c.key) });
        for (const callout of follow) {
          const voiced = voiceOf(callout);
          const said = at + callout.delay;
          const placed: ShowCallout = { at: said, end: said + voiced.length, key: callout.key, text: callout.text, secret: callout.secret, voiced: true, ...(voiced.clip ? { clip: voiced.clip } : {}) };
          callouts.push(placed);
          pending.push({ chat: null, callout: placed, said, length: voiced.length, talk: true, needs: cue, ...(callout.once ? { once: callout.once } : {}) });
        }
      } else cue.voiced = false;
      chatIndex += 1;
    } else if (event.type === 'meeting_start') {
      closeRoam(event.t);
      settle(cursor, 'meeting');
      const bell = Math.max(BELL_SECONDS, meetingLength(index, 'call:'));
      meeting = { kind: 'meeting', start: cursor, end: cursor, info: event, result: null, talkStart: cursor + bell, voteStart: 0, revealAt: 0, resultAt: 0, votes: [] };
      segments.push(meeting);
      cues.push({ at: cursor, end: cursor + bell, event });
      meetingCallout(index, 'call:', cursor);
      cursor += bell;
    } else if (event.type === 'speak') {
      const clip = clips.get(speakIndex);
      const length = clip ? clip.seconds + SPEAK_PAD : readingSeconds(event.say);
      cues.push({ at: cursor, end: cursor + length, event, speakIndex, clip });
      cursor += length + GAP;
      speakIndex += 1;
    } else if (event.type === 'vote') {
      if (meeting && meeting.votes.length === 0) {
        meeting.voteStart = cursor;
        meeting.revealAt = cursor + Math.max(VOTE_THINK_SECONDS, meetingLength(index, 'vote:'));
        meetingCallout(index, 'vote:', cursor);
      }
      meeting?.votes.push(event);
      // 票は全員同時に開く
      const at = meeting ? meeting.revealAt : cursor;
      cues.push({ at, end: at + revealSeconds(event.meeting), event });
    } else if (event.type === 'meeting_end') {
      if (meeting) {
        if (meeting.votes.length === 0) {
          meeting.voteStart = cursor;
          meeting.revealAt = cursor + VOTE_THINK_SECONDS;
        }
        meeting.result = event;
        meeting.resultAt = meeting.revealAt + revealSeconds(event.meeting);
        meetingCallout(index, 'tally:', meeting.revealAt);
        const result = Math.max(event.ejected ? FIRED.seconds : RESULT_SECONDS, meetingLength(index, 'verdict:'));
        meetingCallout(index, 'verdict:', meeting.resultAt);
        cues.push({ at: meeting.resultAt, end: meeting.resultAt + result, event });
        cursor = meeting.resultAt + result;
        meeting.end = cursor;
        meeting = null;
      }
    } else if (event.type === 'game_over') {
      closeRoam(event.t);
      settle(cursor, event.why === 'crisis' ? 'timeout' : 'over');
      // クビになった人の残りの仕込みが減って、数がそろったまま終わる時に、棒を合わせる
      const last = progress.at(-1);
      if (event.tasks && event.tasks.total > 0 && (last?.done !== event.tasks.done || last?.total !== event.tasks.total)) {
        progress.push({ at: cursor, done: event.tasks.done, total: event.tasks.total, bump: false });
      }
      segments.push({ kind: 'ending', start: cursor, end: cursor + ENDING_SECONDS, info: event });
      cues.push({ at: cursor, end: cursor + ENDING_SECONDS, event });
      meetingCallout(index, 'end', cursor);
      cursor += ENDING_SECONDS;
    }
  }
  // 途中で止まった記録（利用枠切れ）は、開いたままの区切りを閉じる
  if (roam) closeRoam((roam as RoamSegment).frames.at(-1)?.t ?? (roam as RoamSegment).clock0);
  if (meeting) (meeting as MeetingSegment).end = cursor;
  settle(cursor, 'over');
  const total = log.roam?.taskTotal ?? 0;
  if (total > 0 && (progress.length === 0 || (progress[0] as ProgressPoint).at > 0)) progress.unshift({ at: 0, done: 0, total, bump: false });

  // 餅に変える直前の差し込み。同じ見回りの中で、前の差し込みと重なるものは出さない。
  // 妖精2人が同じ瞬間に変えた時は、1つの差し込みに2組を並べる（誰が誰を餅にしたかを、どちらも見せる）
  const cutins: Cutin[] = [];
  cues
    .filter((cue) => cue.event.type === 'nap')
    .forEach((cue, index) => {
      const event = cue.event as EventOf<'nap'>;
      const roamOf = segments.find((s): s is RoamSegment => s.kind === 'roam' && cue.at >= s.start - 1e-6 && cue.at <= s.end + 1e-6);
      if (!roamOf) return;
      const end = cue.at - 0.05;
      const last = cutins.at(-1);
      if (last && Math.abs(last.end - end) < 1e-6) {
        last.pairs.push({ by: event.by, target: event.target });
        return;
      }
      const at = Math.max(roamOf.start, end - CUTIN_SECONDS, (last?.end ?? -Infinity) + 0.6);
      if (end - at < 1.1) return;
      const found = keyed.get(`cutin:${index}`);
      cutins.push({ at, end, pairs: [{ by: event.by, target: event.target }], ...(found && found.text === CUTIN_LINE ? { clip: found } : {}) });
    });
  // 差し込みの間に重なる見回りの声は、ふきだしだけにする（決めぜりふと重ねない）。案内役の一言は出さない
  for (const cut of cutins) {
    for (const c of callouts) if (c.voiced && c.end > cut.at && c.at < cut.end + 0.3) c.voiced = false;
    for (const cue of cues) {
      if (cue.event.type !== 'chat' || !cue.voiced || cue.end <= cut.at || cue.at >= cut.end + 0.3) continue;
      const roamOf = segments.find((s): s is RoamSegment => s.kind === 'roam' && cue.at >= s.start - 1e-6 && cue.at <= s.end + 1e-6);
      const said = roamOf ? showTimeOf(roamOf, cue.event.t) : cue.at;
      cue.end = said + (cue.end - cue.at);
      cue.at = said;
      cue.voiced = false;
      delete cue.clip;
    }
  }

  callouts.sort((a, b) => a.at - b.at);
  return { log, segments, cues, total: Math.max(cursor, 1), opening: log.roam?.config.roamSeconds ?? 0, progress, troubles, shuts, sneaks, looks, cutins, callouts };
}

/** その時刻の、仕込みの進み具合。仕込みの無い記録では null。since は、最後に仕込みが1つ終わった時刻（まだなら -Infinity）。 */
export function progressAt(show: Show, time: number): { done: number; total: number; ratio: number; since: number } | null {
  let now: ProgressPoint | null = null;
  let since = -Infinity;
  for (const point of show.progress) {
    if (point.at > time) break;
    now = point;
    if (point.bump) since = point.at;
  }
  if (!now || now.total <= 0) return null;
  return { done: now.done, total: now.total, ratio: Math.min(1, now.done / now.total), since };
}

/** その時刻に起きている困りごと。left は、かまどの残り秒（あかりは null）。 */
export function troubleAt(show: Show, time: number): (TroubleSpan & { age: number; left: number | null }) | null {
  for (const span of show.troubles) {
    if (time < span.start || time >= span.end) continue;
    const age = time - span.start;
    return { ...span, age, left: span.seconds === null ? null : Math.max(0, span.seconds - age) };
  }
  return null;
}

/** その時刻に、戸が閉まっている部屋。 */
export function shutRoomsAt(show: Show, time: number): ShutSpan[] {
  return show.shuts.filter((span) => time >= span.start && time < span.end);
}

export interface DoorRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 戸を閉められる部屋 → その部屋の戸口。試合の決まり（sim の parseMap）と同じ決め方:
 * 戸口の升目か、その隣の升目が、その部屋の床であること。
 */
export function doorRectsOf(map: MapDefinition): Record<string, DoorRect[]> {
  const named: Record<string, string> = { ...map.rooms, ...map.halls };
  const areaAt = (x: number, y: number): string | null => {
    const ch = map.rows[y]?.[x];
    if (ch === undefined || ch === '#' || ch === '%') return null;
    return ch === '.' ? map.corridor : (named[ch] ?? null);
  };
  const out: Record<string, DoorRect[]> = {};
  for (const room of map.closable ?? []) {
    const rects = (map.doors ?? []).filter((door) => {
      for (let y = door.y; y < door.y + door.h; y++) {
        for (let x = door.x; x < door.x + door.w; x++) {
          for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]] as const) if (areaAt(x + dx, y + dy) === room) return true;
        }
      }
      return false;
    });
    if (rects.length > 0) out[room] = rects;
  }
  return out;
}

export function segmentAt(show: Show, time: number): Segment | null {
  return show.segments.find((s) => time >= s.start && time < s.end) ?? show.segments.at(-1) ?? null;
}

/** 上映の時刻から、試合の中の時計（開店までの残り時間の表示に使う）を求める。 */
export function clockAt(show: Show, time: number): number {
  let clock = 0;
  for (const segment of show.segments) {
    if (segment.kind !== 'roam' || segment.start > time) continue;
    clock = roamClockAt(segment, Math.min(time, segment.end - (segment.held ?? 0)));
  }
  return clock;
}

export type PoseState = 'a' | 'w' | 'u' | 'z' | 'x';

export interface ActorPose {
  x: number;
  y: number;
  /** a: 起きている / w: 持ち場で手を動かしている / u: 床下の抜け道の中 / z: ずんだ餅になっている / x: 工房にいない */
  state: PoseState;
  moving: boolean;
  /** 進んでいる向き。右が正。 */
  dx: number;
}

/** 起きていて、工房の中に姿が見えているか。 */
export const isUp = (pose: ActorPose | undefined): pose is ActorPose => pose !== undefined && (pose.state === 'a' || pose.state === 'w');

const STATES = 'awuzx';

/** 見回りの最中の、各自の位置と状態。 */
export function posesAt(show: Show, segment: RoamSegment, time: number): ActorPose[] {
  const seats = show.log.seats.length;
  const step = show.log.roam?.config.tickSeconds ?? 0.2;
  const { frames } = segment;
  if (frames.length === 0) return Array.from({ length: seats }, () => ({ x: 0, y: 0, state: 'x', moving: false, dx: 0 }));
  const local = Math.max(0, roamClockAt(segment, time) - segment.clock0);
  const index = Math.min(frames.length - 1, Math.floor(local / step));
  const a = frames[index] as Frame;
  const b = frames[Math.min(frames.length - 1, index + 1)] as Frame;
  const k = Math.min(1, Math.max(0, local / step - index));
  return Array.from({ length: seats }, (_, i) => {
    const ax = a.pos[i * 2] ?? 0;
    const ay = a.pos[i * 2 + 1] ?? 0;
    const bx = b.pos[i * 2] ?? ax;
    const by = b.pos[i * 2 + 1] ?? ay;
    // 集会のあとの並び直しのように、離れたコマどうしはつながない
    const jump = Math.hypot(bx - ax, by - ay) > 2;
    const mark = a.st[i] ?? 'x';
    const state = (STATES.includes(mark) ? mark : 'x') as PoseState;
    if (state === 'u') {
      // 床下では、入った所から出る所へ、まっすぐ進んでいるものとして扱う（カメラと、役職を見せる時の目印に使う）
      const span = show.sneaks.find((s) => s.seat === i && time >= s.start - 0.3 && time < s.end + 0.3);
      if (span) {
        const to = span.to ?? span.from;
        const q = Math.min(1, Math.max(0, (time - span.start) / Math.max(0.01, span.end - span.start)));
        const p = q * q * (3 - 2 * q); // ゆっくり動き出して、ゆっくり止まる
        return { x: span.from.x + (to.x - span.from.x) * p, y: span.from.y + (to.y - span.from.y) * p, state, moving: false, dx: to.x - span.from.x };
      }
      return { x: ax, y: ay, state, moving: false, dx: 0 };
    }
    return {
      x: jump ? ax : ax + (bx - ax) * k,
      y: jump ? ay : ay + (by - ay) * k,
      state,
      moving: !jump && state === 'a' && Math.hypot(bx - ax, by - ay) > 0.01,
      dx: bx - ax,
    };
  });
}

export interface GhostPose {
  x: number;
  y: number;
  moving: boolean;
  dx: number;
}

/** 心だけになって仕込みを続けている人の位置（席の順。心だけの人でなければ null）。 */
export function ghostsAt(show: Show, segment: RoamSegment, time: number): (GhostPose | null)[] {
  const seats = show.log.seats.length;
  const step = show.log.roam?.config.tickSeconds ?? 0.2;
  const { frames } = segment;
  if (frames.length === 0) return Array.from({ length: seats }, () => null);
  const local = Math.max(0, roamClockAt(segment, time) - segment.clock0);
  const index = Math.min(frames.length - 1, Math.floor(local / step));
  const a = frames[index] as Frame;
  if (!a.gp) return Array.from({ length: seats }, () => null);
  const b = frames[Math.min(frames.length - 1, index + 1)] as Frame;
  const k = Math.min(1, Math.max(0, local / step - index));
  return Array.from({ length: seats }, (_, i) => {
    const ax = a.gp?.[i * 2] ?? -1;
    const ay = a.gp?.[i * 2 + 1] ?? -1;
    if (ax < 0 || ay < 0) return null;
    const nx = b.gp?.[i * 2] ?? -1;
    const ny = b.gp?.[i * 2 + 1] ?? -1;
    const bx = nx < 0 ? ax : nx;
    const by = ny < 0 ? ay : ny;
    const jump = Math.hypot(bx - ax, by - ay) > 2;
    return { x: jump ? ax : ax + (bx - ax) * k, y: jump ? ay : ay + (by - ay) * k, moving: !jump && Math.hypot(bx - ax, by - ay) > 0.01, dx: bx - ax };
  });
}
