// 頭脳（LLM）を呼ぶための共通の形。提供元ごとの違いは providers/ に閉じ込める。

import type { BrainUsage } from '../../protocol/src/index.ts';

export interface BrainRequest {
  /** 全員共通の指示。秘密を入れない（CLI の引数として渡る場合があるため）。 */
  system: string;
  /** 本人だけが知ることを含む本文。標準入力で渡す。 */
  user: string;
  schema: Record<string, unknown>;
}

export interface BrainResult {
  json: unknown;
  usage: BrainUsage | null;
  latencyMs: number;
  /**
   * 応答を信用できない理由（ツールを使った、想定外の道具が見えていた、など）。
   * 1つでもあれば、呼び出し側は json を捨てる。
   */
  problems: string[];
}

export interface Brain {
  /** 記録に残す名前。例: claude-cli:claude-haiku-5-5 */
  readonly id: string;
  decide(request: BrainRequest): Promise<BrainResult>;
}

/** 利用枠が尽きた。代用行動で進めず、試合を止めて保存する（有料経路へ切り替えない）。 */
export class QuotaExhaustedError extends Error {
  /** CLI が返した理由の文（短く切ったもの。無ければ空）。 */
  readonly detail: string;
  constructor(brainId: string, detail = '') {
    const short = detail.replace(/\s+/g, ' ').trim().slice(0, 300);
    super(`利用枠が尽きました: ${brainId}${short ? `（${short}）` : ''}`);
    this.name = 'QuotaExhaustedError';
    this.detail = short;
  }
}

/** 1試合で頭脳を呼んでよい回数を使い切った。利用枠切れと同じく、代用せずに止めて保存する。 */
export class CallLimitError extends QuotaExhaustedError {
  constructor(limit: number) {
    super(`1試合の呼び出しの上限（${limit}回）`);
    this.name = 'CallLimitError';
  }
}

/**
 * 「上限に達した」と返ってきた時に、少し待ってから聞き直す。
 * 同時に何本も呼ぶと、短い間だけ断られることがある（1回断られても、すぐ元に戻ることが多い）。
 * 待っても断られ続ける時だけ、利用枠が尽きたとして止める。待ちは試合の時間を進めない（答えがそろうまで待つため）。
 */
export function patientBrains<T extends Brain | null>(
  brains: readonly T[],
  options: { waits?: readonly number[]; sleep?: (ms: number) => Promise<void>; onWait?: (brainId: string, seconds: number, error: QuotaExhaustedError) => void } = {},
): T[] {
  const waits = options.waits ?? [20, 60, 120];
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  // 同じ頭脳を使う全員で、待ちを共有する（1人が断られたら、ほかの人もしばらく待つ）
  const pause = new Map<string, Promise<void>>();
  const wrapped = new Map<Brain, Brain>();
  return brains.map((brain) => {
    if (brain === null) return brain;
    const known = wrapped.get(brain);
    if (known) return known as T;
    const patient: Brain = {
      id: brain.id,
      decide: async (request) => {
        for (let attempt = 0; ; attempt++) {
          await pause.get(brain.id);
          try {
            return await brain.decide(request);
          } catch (error) {
            if (!(error instanceof QuotaExhaustedError) || error instanceof CallLimitError || attempt >= waits.length) throw error;
            const seconds = waits[attempt] as number;
            if (!pause.has(brain.id)) {
              options.onWait?.(brain.id, seconds, error);
              const wait = sleep(seconds * 1000).then(() => void pause.delete(brain.id));
              pause.set(brain.id, wait);
            }
          }
        }
      },
    };
    wrapped.set(brain, patient);
    return patient as T;
  });
}

/**
 * 返事が遅い時に知らせる（待つのはやめない）。
 * → 返事を待つ時間に上限を付けない。CLI が固まった時に気づけるよう、長く待っている間は一定の間隔で知らせるだけにする。
 */
export function watchedBrains<T extends Brain | null>(brains: readonly T[], options: { everySeconds?: number; onSlow: (brainId: string, seconds: number) => void }): T[] {
  const every = (options.everySeconds ?? 300) * 1000;
  const wrapped = new Map<Brain, Brain>();
  return brains.map((brain) => {
    if (brain === null) return brain;
    const known = wrapped.get(brain);
    if (known) return known as T;
    const watched: Brain = {
      id: brain.id,
      decide: async (request) => {
        const started = Date.now();
        const timer = setInterval(() => options.onSlow(brain.id, Math.round((Date.now() - started) / 1000)), every);
        try {
          return await brain.decide(request);
        } finally {
          clearInterval(timer);
        }
      },
    };
    wrapped.set(brain, watched);
    return watched as T;
  });
}

/**
 * 頭脳の呼び出しに、試合全体での上限を付ける（利用枠を使いすぎないための歯止め）。
 * 上限は全部の頭脳で共有する。台本ボット（null）は数えない。
 */
export function limitCalls<T extends Brain | null>(brains: readonly T[], limit: number): T[] {
  let used = 0;
  return brains.map((brain) => {
    if (brain === null) return brain;
    const limited: Brain = {
      id: brain.id,
      decide: (request) => {
        if (used >= limit) return Promise.reject(new CallLimitError(limit));
        used += 1;
        return brain.decide(request);
      },
    };
    return limited as T;
  });
}
