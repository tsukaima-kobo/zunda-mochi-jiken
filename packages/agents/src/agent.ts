// 1人のエージェント。観測を受け取り、意図を返す。記憶は本人のものだけ。
// ゲーム本体（sim）には依存しない。将来、別のゲームの観測を受け取る形にも差し替えられるようにする。

import { intentJsonSchema, roamIntentJsonSchema } from '../../protocol/src/index.ts';
import type { BrainUsage, IntentSource, MeetingIntent, MeetingObservation, RoamObservation } from '../../protocol/src/index.ts';
import { QuotaExhaustedError } from './brain.ts';
import type { Brain, BrainRequest } from './brain.ts';
import { checkIntent, checkRoamIntent, feedbackFor, roamFeedbackFor, trimSay } from './guard.ts';
import type { RoamDecision } from './guard.ts';
import { AgentMemory } from './memory.ts';
import { renderRoamUser, renderUser, RULES } from './prompt.ts';
import type { PromptMemory } from './prompt.ts';
import { questionFor, scriptedIntent, scriptedRoamIntent } from './scripted.ts';

export interface AttemptRecord {
  attempt: number;
  brain: string;
  request: BrainRequest;
  ok: boolean;
  json: unknown;
  problems: string[];
  usage: BrainUsage | null;
  latencyMs: number;
}

export interface ActResult<I = MeetingIntent> {
  intent: I;
  source: IntentSource;
  attempts: AttemptRecord[];
}

export interface ActHooks {
  /** 頭脳を呼ぶ直前。記録を先に書くために使う。 */
  onRequest?(attempt: number, brain: string, request: BrainRequest): void;
  onResponse?(record: AttemptRecord): void;
}

export interface AgentOptions {
  /** null なら台本ボットだけで動く。 */
  brain: Brain | null;
  /** 台本ボットの種。真の状態から作らない。 */
  seed: number;
  /** 出力に含まれていたら捨てる語（機体や利用者に結びつくもの）。 */
  denyList: readonly string[];
  /** 頭脳に聞く回数の上限（最初の1回＋聞き直し）。 */
  maxAttempts?: number;
  /** プロンプトに入れる記憶の行数の上限。 */
  memoryLines?: number;
  /** 行動が終わってから次を決めるまでの最短の間隔（秒）。前の判断からの秒数で数える。 */
  idleGap?: number;
  /** 歩き回っている間、新しい相手が見えたときに判断し直すまでの最短の間隔（秒）。 */
  minDecisionGap?: number;
  /** 同じ行動を続けていても、この秒数が過ぎたら判断し直す。 */
  maxDecisionInterval?: number;
  /** 名前を呼ばれて聞かれた時に、答えるために判断し直すまでの最短の間隔（秒）。 */
  replyGap?: number;
  /** そばで誰かが話した時に、返事をするために判断し直すまでの最短の間隔（秒）。 */
  chatReplyGap?: number;
}

/** 目の前の出来事のうち、判断を急がせないもの。 */
const CALM_EVENT = /あかりがついた|火が落ち着いた/;

type Check<I> = { ok: true; intent: I } | { ok: false; problems: string[]; trimmed?: I; /** 明らかな悪手の聞き直しだけが問題の答え（聞き直しても同じなら、これを通す）。 */ soft?: I };

interface Question<I> {
  user(feedback?: string): string;
  schema: Record<string, unknown>;
  check(json: unknown): Check<I>;
  feedback(problems: readonly string[]): string;
  fallback(): I;
}

export class Agent {
  readonly brainId: string;
  readonly memory = new AgentMemory();
  private readonly options: AgentOptions;
  private decidedAt = -Infinity;
  private seenAtDecision = new Set<string>();
  private sleepersAtDecision = new Set<string>();
  private round = 1;
  /** 目の前で何かが起きた（まだそれを踏まえた判断をしていない）。 */
  private startled = false;
  /** そばで誰かが話した（まだそれに返事をする判断をしていない）。 */
  private spokenTo = false;
  /** 人狼の力（杖の力・妨害）が、いま使えるようになった（まだそれを踏まえた判断をしていない）。 */
  private powerReady = false;
  /** 前の観測での、杖の力と妨害の残り秒数（使えるようになった瞬間を見つけるため） */
  private powerWait: { nap: number | null; sabotage: number | null } = { nap: null, sabotage: null };

  constructor(options: AgentOptions) {
    this.options = options;
    this.brainId = options.brain?.id ?? 'scripted';
  }

  /** 観測を記憶に入れる。頭脳は呼ばない。 */
  perceive(obs: RoamObservation): void {
    this.memory.perceive(obs);
    if (obs.round !== this.round) {
      // 集会のあとの新しい見回り。前の回の判断の時刻や、見えていた相手は持ち越さない
      this.round = obs.round;
      this.decidedAt = -Infinity;
      this.seenAtDecision = new Set();
      this.sleepersAtDecision = new Set();
      this.startled = false;
      this.spokenTo = false;
      this.powerReady = false;
    }
    // 姿の見えている人の声が聞こえた（雑談に返事をするきっかけ）
    if ((obs.heard ?? []).some((h) => h.speaker !== obs.self.name && h.where !== null)) this.spokenTo = true;
    // 困りごとが片づいた知らせでは、決め直さない（直していた本人は、行動が終わるので決め直す）
    const stirring = obs.events.some((event) => !CALM_EVENT.test(event));
    if (stirring || obs.lastResult?.includes('をずんだ餅に変えた')) this.startled = true;
    // 2026-11-21 夜 頭脳のある人狼は、杖の力か妨害が使えるようになった瞬間に決め直す（本人の待ち時間だけで決まるので、秘密は漏れない）。
    // 最大15秒おきに呼ぶだけだと、妨害で鐘を止める前に鐘を鳴らされることがあった。台本ボットは前と同じ（ボットの試合の結果を変えない）
    const nap = obs.napCooldown;
    const sabotage = obs.sabotage && !obs.trouble ? obs.sabotage.waitSeconds : null;
    if (this.options.brain && ((nap === 0 && (this.powerWait.nap ?? 0) > 0) || (sabotage === 0 && (this.powerWait.sabotage ?? 0) > 0))) this.powerReady = true;
    this.powerWait = { nap, sabotage };
  }

  /**
   * いま次の行動を決めるべきか。理由を返す（決めなくてよければ null）。
   * 判断の材料は本人の観測だけ。呼ばれる時刻そのものが、見えない出来事の手がかりにならないようにする。
   */
  wantsToDecide(obs: RoamObservation): string | null {
    if (obs.secondsUntilOpening <= 0) return null;
    const since = obs.clock - this.decidedAt;
    // 急ぎ: ずんだ餅になった人を新しく見つけた、目の前で誰かが餅に変わった、自分が変えた直後。間隔を待たずに決め直す
    if (obs.visible.some((v) => v.asleep && !this.sleepersAtDecision.has(v.name))) return 'found_sleeper';
    if (this.startled) return 'startled';
    if (this.powerReady) return 'power_ready';
    // 名前を呼ばれて、何か聞かれた（答えるために決め直す。続けざまにはしない）
    if (questionFor(obs) && since >= (this.options.replyGap ?? 2)) return 'asked';
    // そばで話しかけられた・誰かが話した。話せる時に、返事をするために決め直す（続けざまにはしない）。
    // 雑談のためのきっかけなので、頭脳のある登場人物だけ（台本ボットは、名前を呼ばれて聞かれた時だけ答える）
    if (this.options.brain && this.spokenTo && (obs.chatWaitSeconds ?? 0) === 0 && since >= (this.options.chatReplyGap ?? 3)) return 'spoken_to';
    // 行動が終わっても、少しその場を見てから次を決める（呼び出しの回数も抑えられる）
    if (obs.idle) return since >= (this.options.idleGap ?? 4) ? 'idle' : null;
    const newFace = obs.visible.some((v) => !v.asleep && !this.seenAtDecision.has(v.name));
    if (newFace && since >= (this.options.minDecisionGap ?? 5)) return 'new_face';
    if (since >= (this.options.maxDecisionInterval ?? 15)) return 'interval';
    return null;
  }

  /** 会議での発言・投票を決める。 */
  act(obs: MeetingObservation, hooks: ActHooks = {}): Promise<ActResult<MeetingIntent>> {
    const { seed, denyList } = this.options;
    const memory = this.promptMemory();
    const result = this.ask<MeetingIntent>(
      {
        user: (feedback) => renderUser(obs, feedback, memory),
        schema: intentJsonSchema(obs),
        check: (json) => {
          const verdict = checkIntent(obs, json, denyList);
          if (verdict.ok) return verdict;
          const trimmed = verdict.trimmable
            ? ({ kind: 'speak', ...verdict.trimmable, say: trimSay(verdict.trimmable.say, obs.limits.sayMaxChars) } as const)
            : undefined;
          return { ok: false, problems: verdict.problems, trimmed, ...(verdict.keep ? { soft: verdict.keep } : {}) };
        },
        feedback: (problems) => feedbackFor(problems, obs),
        fallback: () => scriptedIntent(obs, seed, [...memory.past, ...memory.recent]),
      },
      hooks,
    );
    // 投票を終えたら、この回の記憶を畳んで、覚え書きだけを次の回へ持っていく
    return result.then((r) => {
      if (r.intent.kind === 'vote') this.memory.closeRound(r.intent.memo);
      return r;
    });
  }

  private promptMemory(): PromptMemory {
    return { recent: this.memory.recent(this.options.memoryLines ?? 40), past: this.memory.pastNotes(), sightings: this.memory.lastSightings(), talk: this.memory.recentTalk(14) };
  }

  /** 歩き回っている間の、次の行動を決める。 */
  actRoam(obs: RoamObservation, hooks: ActHooks = {}): Promise<ActResult<RoamDecision>> {
    const { seed, denyList } = this.options;
    this.decidedAt = obs.clock;
    this.seenAtDecision = new Set(obs.visible.map((v) => v.name));
    this.sleepersAtDecision = new Set(obs.visible.filter((v) => v.asleep).map((v) => v.name));
    this.startled = false;
    this.spokenTo = false;
    this.powerReady = false;
    const memory = this.promptMemory();
    return this.ask<RoamDecision>(
      {
        user: (feedback) => renderRoamUser(obs, feedback, memory),
        schema: roamIntentJsonSchema(obs),
        check: (json) => checkRoamIntent(obs, json, denyList),
        feedback: (problems) => roamFeedbackFor(problems, obs),
        fallback: () => scriptedRoamIntent(obs, seed),
      },
      hooks,
    );
  }

  private async ask<I>(question: Question<I>, hooks: ActHooks): Promise<ActResult<I>> {
    const { brain } = this.options;
    const maxAttempts = this.options.maxAttempts ?? 2;
    const attempts: AttemptRecord[] = [];
    if (!brain) return { intent: question.fallback(), source: 'fallback', attempts };

    let feedback: string | undefined;
    let trimmed: I | undefined;
    // 明らかな悪手の聞き直しだけが問題だった答え。聞き直しても同じなら、これを通す（試合を止めない・台本の代わりに落とさない）
    let kept: I | undefined;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const request: BrainRequest = { system: RULES, user: question.user(feedback), schema: question.schema };
      hooks.onRequest?.(attempt, brain.id, request);

      let json: unknown = null;
      let usage: BrainUsage | null = null;
      let problems: string[];
      let latencyMs = 0;
      const started = performance.now();
      try {
        const result = await brain.decide(request);
        ({ json, usage, latencyMs } = result);
        problems = result.problems;
      } catch (error) {
        if (error instanceof QuotaExhaustedError) throw error;
        // 失敗の中身は記録にだけ残し、次のプロンプトには混ぜない
        latencyMs = Math.round(performance.now() - started);
        problems = [`brain_error:${error instanceof Error ? error.name : 'unknown'}`];
      }

      // 提供元が「信用できない」と言った応答は、中身を見ずに捨てる
      const verdict = problems.length > 0 ? null : question.check(json);
      if (verdict && !verdict.ok) problems = verdict.problems;
      const record: AttemptRecord = { attempt, brain: brain.id, request, ok: verdict?.ok ?? false, json, problems, usage, latencyMs };
      attempts.push(record);
      hooks.onResponse?.(record);

      if (verdict?.ok) return { intent: verdict.intent, source: attempt === 1 ? 'brain' : 'retry', attempts };
      if (verdict && !verdict.ok && verdict.trimmed !== undefined) trimmed = verdict.trimmed;
      if (verdict && !verdict.ok && verdict.soft !== undefined) kept = verdict.soft;
      feedback = verdict ? question.feedback(problems) : undefined;
    }

    // 長すぎること以外に問題がなかった発言は、切って使う
    if (trimmed !== undefined) return { intent: trimmed, source: 'trimmed', attempts };
    if (kept !== undefined) return { intent: kept, source: attempts.length === 1 ? 'brain' : 'retry', attempts };
    return { intent: question.fallback(), source: 'fallback', attempts };
  }
}

/** 会議だけの形で使っていた名前。 */
export { Agent as MeetingAgent };
export type { AgentOptions as MeetingAgentOptions };
