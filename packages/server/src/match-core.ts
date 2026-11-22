// 進行役の共通部分: 試合の記録、エージェントの用意、会議の進行。
// 進行役は真の状態（sim）とエージェントのあいだに立つ。エージェントに渡すのは観測だけ。

import { Agent } from '../../agents/src/index.ts';
import type { ActHooks, ActResult, Brain } from '../../agents/src/index.ts';
import { ROLE_LABEL, SIDE_LABEL, SKIP_VOTE } from '../../protocol/src/index.ts';
import type { Absence, AnyIntent, BondView, DeviceKind, IntentSource, Role, Side, SuspicionEntry } from '../../protocol/src/index.ts';
import { applyBallots, applySpeak, buildCeremonyObservation, buildObservation, currentSpeaker, nameOf, playerById, seatIdByName } from '../../sim/src/index.ts';
import type { Ballot, CeremonyPhase, GameResult, MapDefinition, MeetingConfig, MeetingWorld, PlayerId, RoamConfig } from '../../sim/src/index.ts';
import { Journal } from './journal.ts';

/** 1回の集会の結果。票数は全員に公開される（誰が誰に入れたかは公開されない）。 */
export interface MeetingResult {
  tally: { target: string; count: number }[];
  ejected: string | null;
  ejectedRole: Role | null;
  verdict: string;
}

export type MeetingEvent =
  /** respoken: 上映の編集で、あとから同じ問いを同じ AI に聞き直した答えに替えた発言（edits.json の respeak）。試合の記録には付かない。 */
  | { type: 'speak'; meeting: number; round: number; speaker: string; say: string; thought: string; suspect: string; source: IntentSource; brain: string; latencyMs: number; respoken?: boolean }
  /** memo は本人の記憶にだけ残る覚え書き、suspicion は疑い度（0〜5、席順）。どちらも観戦者にだけ見せる。古い記録には suspicion が無い。 */
  | { type: 'vote'; meeting: number; voter: string; vote: string; thought: string; memo: string; suspicion?: SuspicionEntry[]; source: IntentSource; brain: string; latencyMs: number }
  /** 朝礼（greet: 最初の見回りの前）・日記（diary）・感想会（review）。日記と感想会は試合のあと（game_over より後ろ）。 */
  | { type: 'talk'; phase: CeremonyPhase; speaker: string; say: string; thought: string; source: IntentSource; brain: string; latencyMs: number }
  | ({ type: 'meeting_end'; meeting: number } & MeetingResult);

export type RoamEvent =
  /** tasks は、その時点の仕込みの進み具合（クビになった従業員の残りは、全部の数から引かれている）。仕込みの無いマップでは無い。 */
  | { type: 'round_start'; t: number; round: number; tasks?: { done: number; total: number } }
  /** t は意図を適用した時刻（秒）。applied が false なら、適用の時点で断られた（note に理由）。 */
  | { type: 'decide'; t: number; agent: string; action: string; target: string; thought: string; say?: string; source: IntentSource; brain: string; latencyMs: number; applied: boolean; note: string | null }
  /** 見回りの間に、近くの人にだけ聞こえる声で話した。heard は聞こえた人（観戦者とログのため。本人たちには渡さない）。 */
  // keep / mute: 上映の編集（edits.json）で、必ず声にする / 声にしない雑談。keep の数が大きいほど、同じ瞬間の声の中で先に鳴らす
  | { type: 'chat'; t: number; speaker: string; say: string; heard: string[]; keep?: number; mute?: boolean }
  /** 人がずんだ餅に変えられた（type の名前は前の題材のなごり）。witnesses の sawWho が false の人は、餅に変わるところだけを見た。 */
  | { type: 'nap'; t: number; by: string; target: string; room: string; witnesses: { name: string; sawWho: boolean; camera?: string }[] }
  /** 仕込みの手順が1つ終わった。pretend はふりだけ（進み具合は増えない。妖精と妖精マニア）。spirit は、ずんだ餅になった従業員が心だけで進めた分。 */
  /** fox: 狐の分だけ。狐自身の仕込みの進み（横取りの条件。2026-11-21 から）。 */
  | { type: 'task'; t: number; agent: string; duty: string; what: string; station: string; pretend: boolean; spirit: boolean; done: number; total: number; fox?: { done: number; need: number } }
  /** 妨害。what が door のとき room はその部屋、seconds は閉まっている秒数。crisis の seconds は猶予。 */
  | { type: 'sabotage'; t: number; by: string; what: 'lights' | 'crisis' | 'door'; room: string | null; seconds: number | null }
  | { type: 'fixed'; t: number; what: 'lights' | 'crisis'; by: string[] }
  | { type: 'door_open'; t: number; room: string }
  /** 床下の抜け道の出入り。witnesses は、それを見ていた人。 */
  | { type: 'sneak'; t: number; by: string; phase: 'in' | 'out'; room: string; hatch: string; witnesses: string[] }
  | { type: 'bell'; t: number; by: string }
  /**
   * 占い師が占った。fairy: 妖精だった。cursed: 占われた狐が、その場でずんだ餅に変わった（witnesses は、餅に変わるところを見た人）。
   * 結果を知っているのは占い師だけ（観戦者とログのための記録）。
   */
  | { type: 'divine'; t: number; by: string; target: string; room: string; fairy: boolean; cursed: boolean; witnesses: { name: string; camera?: string }[] }
  /** 妖精が狐に手をかざしたが、狐はずんだ餅にならなかった（2026-11-21 から）。 */
  | { type: 'nap_failed'; t: number; by: string; target: string; room: string; witnesses: { name: string; camera?: string }[] }
  /**
   * 工房の道具を見た（見取り図の盤・名札かけ・防犯カメラの画面）。start は見始め、end は見終わり（aborted は途中でやめた）。
   * end には、見えたもの: counts は部屋ごとの人数、tags は全員の名札、seen はカメラごとに映った人（防犯カメラは、途中でやめても入る）。
   */
  | {
      type: 'look';
      t: number;
      agent: string;
      device: DeviceKind;
      phase: 'start' | 'end';
      aborted?: boolean;
      counts?: Record<string, number>;
      tags?: { name: string; status: 'awake' | 'asleep' | 'sent_home' }[];
      seen?: { camera: string; names: string[] }[];
    }
  /** kind が bell のときは、中庭の鐘で集まった（found と room は null）。 */
  | { type: 'meeting_start'; t: number; meeting: number; kind: 'report' | 'bell'; reason: string; reporter: string; found: string | null; room: string | null; attendees: string[]; absent: Absence[] }
  /** tasks は終わった時の仕込みの数（集会でクビになった人の残りが減って、そのまま終わることがある）。 */
  | { type: 'game_over'; t: number; winner: Role; why: GameResult['why']; stolenFrom?: Side; foxMissed?: { done: number; need: number }; tasks?: { done: number; total: number } };

export type MatchEvent = MeetingEvent | RoamEvent;

export interface BrainStats {
  calls: number;
  rejected: number;
  inputTokens: number;
  outputTokens: number;
  latencyMsTotal: number;
  apiEquivalentUsd: number;
}

export interface MatchLog {
  version: 2;
  matchId: string;
  seed: number;
  /** meeting: 会議だけ / match: 見回りと集会をくり返す試合 */
  mode: 'meeting' | 'match';
  /** finished: 最後まで進んだ / stopped_quota: 利用枠が尽きて止めた / stopped_limit: 1試合の呼び出しの上限に達して止めた */
  status: 'finished' | 'stopped_quota' | 'stopped_limit';
  /** 止まった時の理由（どの頭脳が、何と言って止まったか）。 */
  stopped?: string;
  config: MeetingConfig;
  /** 観戦者とログのための正解。エージェントには渡していない。 */
  players: { name: string; role: Role; persona: string; style?: string; bonds?: BondView[]; attending: boolean; brain: string | null }[];
  truth: Record<string, string>;
  reason: string;
  seats: string[];
  /**
   * 続けて流す動画の中の位置（上映の編集 edits.json で付ける。試合の記録そのものには無い）。
   * part / of: 何試合目か・全部で何試合か。efforts: 試合ごとの「AI の考える深さ」（low・medium など）。
   * next: 最後の試合のあとの次回予告の印。promo: 締めのあとに、お知らせが続く。
   * episode: シリーズの何本目か（1本目は無い）。
   */
  series?: { part: number; of: number; efforts?: string[]; next?: string; promo?: boolean; episode?: number };
  /**
   * 上映の編集で決めた、冒頭のダイジェスト（edits.json の digest）。
   * lines: 集会の発言。書いた順に見せる。無ければ、決まりで1つ選ぶ。
   * nap: 餅に変える所を、どれにするか（誰が誰を）。無ければ、決まりで選ぶ。
   * seen: 抜け道から出てくる所を見られた瞬間を、餅に変える所のあとに足す（誰が出てきたか）。
   */
  digest?: { lines?: { speaker: string; meeting: number; starts: string; label?: string }[]; nap?: { by: string; target: string }; seen?: { by: string }; sweet?: boolean };
  /** 上映の編集で足した、開票の時の案内役の補足（edits.json の asides）。票の札が開いている間に言う。票そのものは変えない。 */
  asides?: { meeting: number; text: string }[];
  /**
   * 上映の編集で、手で書き直した案内（edits.json の narration・callouts）。勝ち負け・票・行動は変えない。案内役の言葉だけを替える。
   * lines: 場面の言葉（キーは moves:3・doubt:2・marks:1・result など。台本の案内にある場面だけ）。
   * callouts: 試合の中の一言（キーは nap:<出来事の番号>・call:<集会>・tally:<集会>・verdict:<集会>・end、または一言の印 inaba など）。null は言わない。
   */
  rewrites?: { lines?: Record<string, string[]>; callouts?: Record<string, string | null> };
  events: MatchEvent[];
  /** 会議だけの版の結果。 */
  outcome: (MeetingResult & { winner: Side }) | null;
  /** 試合の版の結果。clock は終わった時刻（歩き回った秒数）。 */
  result: { winner: Side; why: GameResult['why']; stolenFrom?: Side; foxMissed?: { done: number; need: number }; clock: number; rounds: number; meetings: number } | null;
  stats: {
    byBrain: Record<string, BrainStats>;
    sources: Record<IntentSource, number>;
    /** 役職ごとの代用の回数。片方の役職だけ多いと、代用の発言から役職が透ける。 */
    fallbackByRole: Record<Role, number>;
  };
  /**
   * 歩き回りの記録（mode が match のとき）。r は何回目の見回りか、pos は名簿順に [x0, y0, x1, y1, …]、
   * st は名簿順の1文字ずつ（a: 起きている / w: 持ち場で手を動かしている / u: 床下の抜け道の中 / z: ずんだ餅になっている / x: 工房にいない）。
   * gp は、心だけになって仕込みを続けている人の位置（名簿順に [x0, y0, …]。いない人は -1）。誰もいなければ省く。
   * taskTotal は、始まった時の、従業員の仕込みの手順の数。steps は、名簿順の、1人ずつの手順の数（妖精と妖精マニアの分は見せかけ）。
   */
  roam?: { config: RoamConfig; map: MapDefinition; taskTotal: number; steps: number[]; frames: { r: number; t: number; pos: number[]; st: string; gp?: number[] }[] };
}

export interface CommonRunOptions {
  seed: number;
  /** 席順に、循環して割り当てる。null は台本ボット。 */
  brains: readonly (Brain | null)[];
  /** 登場人物の名前ごとの頭脳（席は種で入れ替わるので、キャラと AI を固定する時はこちら）。名前が載っていれば brains より優先。 */
  brainsByName?: Readonly<Record<string, Brain | null>>;
  denyList: readonly string[];
  now?: () => Date;
  onEvent?: (event: MatchEvent) => void;
  onStart?: (log: MatchLog) => void;
}

export function latencyOf(result: ActResult<unknown>): number {
  return result.attempts.reduce((sum, a) => sum + a.latencyMs, 0);
}

export class Match {
  readonly log: MatchLog;
  readonly journal: Journal;
  readonly agents = new Map<PlayerId, Agent>();
  private readonly world: MeetingWorld;
  private readonly onEvent: CommonRunOptions['onEvent'];

  constructor(world: MeetingWorld, mode: MatchLog['mode'], truth: Record<string, string>, options: CommonRunOptions) {
    const now = options.now ?? (() => new Date());
    const matchId = `m${options.seed}-${now().toISOString().replace(/[-:.]/g, '').slice(0, 15)}`;
    this.world = world;
    this.journal = new Journal(now);
    this.onEvent = options.onEvent;

    world.roster.forEach((id, seat) => {
      const name = nameOf(world, id);
      const brain = options.brainsByName && name in options.brainsByName ? (options.brainsByName[name] ?? null) : (options.brains[seat % options.brains.length] ?? null);
      this.agents.set(id, new Agent({ brain, seed: options.seed * 1000 + seat, denyList: options.denyList }));
    });

    this.log = {
      version: 2,
      matchId,
      seed: options.seed,
      mode,
      status: 'finished',
      config: world.config,
      players: world.players.map((p) => ({
        name: p.name,
        role: p.role,
        persona: p.persona,
        style: p.style,
        bonds: p.bonds,
        attending: world.roster.includes(p.id),
        brain: this.agents.get(p.id)?.brainId ?? null,
      })),
      truth,
      reason: world.meeting.reason,
      seats: world.roster.map((id) => nameOf(world, id)),
      events: [],
      outcome: null,
      result: null,
      stats: { byBrain: {}, sources: { brain: 0, retry: 0, trimmed: 0, fallback: 0 }, fallbackByRole: { artisan: 0, nibbler: 0, madman: 0, fox: 0, seer: 0 } },
    };
    this.journal.append({ type: 'match_start', matchId, seed: options.seed, config: world.config, players: this.log.players });
    options.onStart?.(this.log);
  }

  agentOf(id: PlayerId): Agent {
    return this.agents.get(id) as Agent;
  }

  record(event: MatchEvent): void {
    this.log.events.push(event);
    this.onEvent?.(event);
  }

  /** 頭脳への要求は呼ぶ前に、応答は届いた時に、記録へ書く。 */
  hooksFor(turn: number, agent: string): ActHooks {
    return {
      onRequest: (attempt, brain, request) =>
        this.journal.append({ type: 'request', turn, agent, attempt, brain, system: request.system, user: request.user, schema: request.schema }),
      onResponse: (r) => {
        this.journal.append({ type: 'response', turn, agent, attempt: r.attempt, brain: r.brain, ok: r.ok, json: r.json, problems: r.problems, usage: r.usage, latencyMs: r.latencyMs });
        const s = (this.log.stats.byBrain[r.brain] ??= { calls: 0, rejected: 0, inputTokens: 0, outputTokens: 0, latencyMsTotal: 0, apiEquivalentUsd: 0 });
        s.calls += 1;
        if (!r.ok) s.rejected += 1;
        s.inputTokens += r.usage?.inputTokens ?? 0;
        s.outputTokens += r.usage?.outputTokens ?? 0;
        s.latencyMsTotal += r.latencyMs;
        s.apiEquivalentUsd += r.usage?.apiEquivalentUsd ?? 0;
      },
    };
  }

  /** 確定した意図を記録する。 */
  applied(turn: number, id: PlayerId, result: ActResult<AnyIntent>, note?: string): void {
    this.journal.append({ type: 'apply', turn, agent: nameOf(this.world, id), source: result.source, intent: result.intent, ...(note ? { note } : {}) });
    this.log.stats.sources[result.source] += 1;
    // 台本ボットだけの席は「代用」ではないので、頭脳を持つ席だけ数える
    if (result.source === 'fallback' && this.agentOf(id).brainId !== 'scripted') {
      this.log.stats.fallbackByRole[playerById(this.world, id).role] += 1;
    }
  }

  close(): MatchLog {
    this.journal.append({ type: 'match_end', result: { status: this.log.status, outcome: this.log.outcome, result: this.log.result } });
    return this.log;
  }
}

/** 会議を最後まで進めて、結果を返す。利用枠切れ（QuotaExhaustedError）は呼び出し元へ投げる。 */
export async function conductMeeting(world: MeetingWorld, match: Match, firstTurn: number): Promise<MeetingResult> {
  const { meeting } = world;
  let turn = firstTurn;

  // 発言: 1人ずつ。前の人の発言が確定してから、次の人の観測を作る
  for (let speakerId = currentSpeaker(world); speakerId !== null; speakerId = currentSpeaker(world)) {
    const name = nameOf(world, speakerId);
    const round = meeting.round;
    const agent = match.agentOf(speakerId);
    const result = await agent.act(buildObservation(world, speakerId), match.hooksFor(turn, name));
    if (result.intent.kind !== 'speak') throw new Error('発言の番に発言以外の意図が返りました');
    applySpeak(world, speakerId, result.intent.say); // ルールは進行役の側でもう一度確かめる
    match.applied(turn, speakerId, result);
    const { say, thought, suspect } = result.intent;
    match.record({ type: 'speak', meeting: meeting.index, round, speaker: name, say: say.trim(), thought, suspect, source: result.source, brain: agent.brainId, latencyMs: latencyOf(result) });
    turn += 1;
  }

  // 投票: 全員に同時に聞く。観測は全員分を先に作るので、誰も他人の票を見ない
  const voters = meeting.seats.map((id) => ({ id, name: nameOf(world, id), obs: buildObservation(world, id) }));
  const settled = await Promise.allSettled(voters.map((v) => match.agentOf(v.id).act(v.obs, match.hooksFor(turn, v.name))));
  const failure = settled.find((s) => s.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;

  const ballots: Record<PlayerId, Ballot> = {};
  voters.forEach((voter, i) => {
    const result = (settled[i] as PromiseFulfilledResult<ActResult>).value;
    if (result.intent.kind !== 'vote') throw new Error('投票の番に投票以外の意図が返りました');
    const { vote, thought, memo, suspicion } = result.intent;
    ballots[voter.id] = vote === SKIP_VOTE ? 'skip' : (seatIdByName(world, vote) ?? 'skip');
    match.applied(turn, voter.id, result);
    match.record({ type: 'vote', meeting: meeting.index, voter: voter.name, vote, thought, memo, suspicion, source: result.source, brain: match.agentOf(voter.id).brainId, latencyMs: latencyOf(result) });
  });

  const outcome = applyBallots(world, ballots);
  const result: MeetingResult = {
    tally: outcome.tally.map((row) => ({ target: row.target === 'skip' ? SKIP_VOTE : nameOf(world, row.target), count: row.count })),
    ejected: outcome.ejectedId ? nameOf(world, outcome.ejectedId) : null,
    ejectedRole: outcome.ejectedId ? playerById(world, outcome.ejectedId).role : null,
    verdict: outcome.verdict,
  };
  match.record({ type: 'meeting_end', meeting: meeting.index, ...result });
  return result;
}

/**
 * 朝礼・日記・感想会。名簿順に1人ずつ話す。朝礼と感想会は前の人の言葉を聞いてから話し、
 * 日記は全員に同時に聞く（ほかの人の日記は見ない）。told は試合のあと（diary / review）に全員へ明かす結果の文。
 * 戻り値は、次に使える記録の番号（turn）。
 */
export async function conductCeremony(world: MeetingWorld, match: Match, phase: CeremonyPhase, firstTurn: number, told: string | null): Promise<number> {
  const who = world.roster;
  const keep = (id: PlayerId, turn: number, result: ActResult) => {
    if (result.intent.kind !== 'speak') throw new Error(`${phase} の番に、話す以外の意図が返りました`);
    const say = result.intent.say.trim();
    match.applied(turn, id, result);
    match.record({ type: 'talk', phase, speaker: nameOf(world, id), say, thought: result.intent.thought, source: result.source, brain: match.agentOf(id).brainId, latencyMs: latencyOf(result) });
    return say;
  };
  if (phase === 'diary') {
    const observations = who.map((id) => buildCeremonyObservation(world, id, phase, [], told));
    const settled = await Promise.allSettled(who.map((id, i) => match.agentOf(id).act(observations[i]!, match.hooksFor(firstTurn + i, nameOf(world, id)))));
    const failure = settled.find((s) => s.status === 'rejected');
    if (failure?.status === 'rejected') throw failure.reason;
    who.forEach((id, i) => keep(id, firstTurn + i, (settled[i] as PromiseFulfilledResult<ActResult>).value));
    return firstTurn + who.length;
  }
  const spoken: { speakerId: PlayerId; text: string }[] = [];
  let turn = firstTurn;
  for (const id of who) {
    const result = await match.agentOf(id).act(buildCeremonyObservation(world, id, phase, spoken, told), match.hooksFor(turn, nameOf(world, id)));
    spoken.push({ speakerId: id, text: keep(id, turn, result) });
    turn += 1;
  }
  return turn;
}

const VERDICT_LABEL: Record<string, string> = { tie: '最多が同数', too_few: '最多が1票以下', skip_wins: 'スキップが最多以上', ejected: '' };

/** 1回の集会の結果を、観戦者向けの1文にする（役職つき）。 */
export function describeMeeting(result: MeetingResult): string {
  return result.ejected && result.ejectedRole
    ? `${result.ejected} をクビにした（${ROLE_LABEL[result.ejectedRole]}でした）`
    : `誰もクビにならなかった（${VERDICT_LABEL[result.verdict] ?? result.verdict}）`;
}

export const WHY_LABEL: Record<GameResult['why'], string> = {
  nibbler_sent_home: 'ずんだの妖精を全員クビにした',
  tasks_done: '従業員の仕込みがぜんぶ終わった',
  opened: '開店の時刻まで工房を守りきった',
  outnumbered: '起きている人間が、ずんだの妖精の人数以下になった',
  crisis: 'かまどの焚きすぎを直せなかった',
  late: '開店の時刻までに仕込みが終わらなかった',
};

export function describeOutcome(log: MatchLog): string {
  const win = (side: Side) => `${SIDE_LABEL[side]}の勝ち${side === 'nibbler' && log.truth.madman ? '（妖精マニアも勝ち）' : ''}`;
  if (log.result?.stolenFrom) return `${WHY_LABEL[log.result.why]} → ${SIDE_LABEL[log.result.stolenFrom]}の勝ち…のはずが、狐が起きていたので狐の勝ち`;
  if (log.result) return `${WHY_LABEL[log.result.why]} → ${win(log.result.winner)}`;
  if (!log.outcome) return '途中で止まりました（利用枠切れ）。';
  return `${describeMeeting(log.outcome)} → ${win(log.outcome.winner)}`;
}
