// 試合を1回、最後まで進める: 見回り → （ずんだ餅になった人の発見）→ 集会 → 見回り → … → 勝敗。
//
// 時間の進め方（録画用の「揃えてから進める」方式）:
// - 時刻 t の観測で求めた意図は、全員同じ「反応の遅れ」のあと、t + D に適用する。
// - 頭脳の呼び出しは、きっかけが出た時点ですぐ始める（同じころに出た要求は並行に走る）。
// - 適用の時刻になっても答えが届いていなければ、届くまでゲーム内の時間を止める。
//   そのため、応答の速い頭脳が有利にならない。待ち時間は記録の再生には現れない。
// - 同じ刻みに重なった意図は、席順ではなく、種と時刻から決めた順に適用する。

import { CallLimitError, QuotaExhaustedError } from '../../agents/src/index.ts';
import type { ActResult, RoamDecision } from '../../agents/src/index.ts';
import {
  actorById,
  actorMark,
  applyRoamIntent,
  speakAloud,
  awakeIds,
  buildRoamObservation,
  createRoamWorld,
  endMeeting,
  nameOf,
  noteRejection,
  playerById,
  RuleViolation,
  stepRoam,
  tickOrder,
} from '../../sim/src/index.ts';
import type { MapDefinition, MeetingConfig, PlayerId, RoamConfig, RoamWorld } from '../../sim/src/index.ts';
import { SIDE_LABEL } from '../../protocol/src/index.ts';
import { conductCeremony, conductMeeting, latencyOf, Match, WHY_LABEL } from './match-core.ts';
import type { CommonRunOptions, MatchLog } from './match-core.ts';

export interface MatchRunOptions extends CommonRunOptions {
  map: MapDefinition;
  players?: number;
  roam?: Partial<RoamConfig>;
  config?: Partial<MeetingConfig>;
  /** 反応の遅れ D（秒）。全員同じ。 */
  reactionSeconds?: number;
  /** テスト用: 始める前に真の状態へ手を入れる。 */
  prepareWorld?: (world: RoamWorld) => void;
  /** 朝礼（最初の見回りの前）と、日記・感想会（勝敗が決まったあと）を行う。1人3回ずつ頭脳を呼ぶ。 */
  ceremonies?: boolean;
  /** 試合のあとの日記と感想会（ceremonies も要る）。 */
  afterTalk?: boolean;
}

/** 記録の番号（ジャーナルの turn）。見回りと集会は刻みの番号を使うので、重ならない所から振る。 */
const GREET_TURN = -1000;
const AFTER_TURN = 1_000_000;

type RoamResult = ActResult<RoamDecision>;
type Settled = { ok: true; result: RoamResult } | { ok: false; error: unknown };
interface Pending {
  dueTick: number;
  answer: Promise<Settled>;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export async function runMatch(options: MatchRunOptions): Promise<MatchLog> {
  const world = createRoamWorld({ seed: options.seed, map: options.map, players: options.players, roam: options.roam, config: options.config });
  options.prepareWorld?.(world);
  const truth: Record<string, string> = { nibbler: world.truth.nibblerIds.map((id) => nameOf(world, id)).join('、') };
  if (world.truth.madmanIds.length > 0) truth.madman = world.truth.madmanIds.map((id) => nameOf(world, id)).join('、');
  if (world.truth.foxIds.length > 0) truth.fox = world.truth.foxIds.map((id) => nameOf(world, id)).join('、');
  const match = new Match(world, 'match', truth, options);
  const frames: NonNullable<MatchLog['roam']>['frames'] = [];
  const steps = world.roster.map((id) => actorById(world, id).duties.reduce((n, duty) => n + duty.steps.length, 0));
  match.log.roam = { config: world.roam, map: options.map, taskTotal: world.taskTotal, steps, frames };
  const tasks = () => (world.taskTotal > 0 ? { tasks: { done: world.taskDone, total: world.taskTotal } } : {});

  const delayTicks = Math.max(1, Math.round((options.reactionSeconds ?? 1) / world.roam.tickSeconds));
  const totalTicks = Math.round(world.roam.roamSeconds / world.roam.tickSeconds);
  const pending = new Map<PlayerId, Pending>();
  const name = (id: PlayerId) => nameOf(world, id);

  const snapshot = () => {
    const actors = world.roster.map((id) => actorById(world, id));
    const dreaming = actors.some((actor) => actor.spirit && playerById(world, actor.id).status === 'asleep');
    frames.push({
      r: world.round,
      t: world.clock,
      pos: actors.flatMap((actor) => [round2(actor.pos.x), round2(actor.pos.y)]),
      st: actors.map((actor) => actorMark(world, actor)).join(''),
      ...(dreaming
        ? { gp: actors.flatMap((actor) => (actor.spirit && playerById(world, actor.id).status === 'asleep' ? [round2(actor.spirit.pos.x), round2(actor.spirit.pos.y)] : [-1, -1])) }
        : {}),
    });
  };

  let incidentsRecorded = 0;
  let happeningsRecorded = 0;
  const recordIncidents = () => {
    // 1刻みの中では、仕込み・抜け道・直す作業が先で、餅に変えるのはそのあと。記録もその順にする
    for (const h of world.happenings.slice(happeningsRecorded)) {
      if (h.type === 'task') match.record({ type: 'task', t: h.t, agent: name(h.id), duty: h.duty, what: h.what, station: h.station, pretend: h.pretend, spirit: h.spirit, done: h.done, total: h.total });
      else if (h.type === 'sabotage') match.record({ type: 'sabotage', t: h.t, by: name(h.id), what: h.what, room: h.room, seconds: h.seconds });
      else if (h.type === 'fixed') match.record({ type: 'fixed', t: h.t, what: h.what, by: h.ids.map(name) });
      else if (h.type === 'door_open') match.record({ type: 'door_open', t: h.t, room: h.room });
      else if (h.type === 'sneak') match.record({ type: 'sneak', t: h.t, by: name(h.id), phase: h.phase, room: h.room, hatch: h.hatch, witnesses: h.witnesses.map(name) });
      else if (h.type === 'chat') match.record({ type: 'chat', t: h.t, speaker: name(h.id), say: h.text, heard: h.heard.map(name) });
      else if (h.type === 'look') {
        match.record({
          type: 'look',
          t: h.t,
          agent: name(h.id),
          device: h.device,
          phase: h.phase,
          ...(h.aborted ? { aborted: true } : {}),
          ...(h.counts ? { counts: h.counts } : {}),
          ...(h.tags ? { tags: h.tags.map((tag) => ({ name: name(tag.id), status: tag.status })) } : {}),
          ...(h.seen ? { seen: h.seen.map((view) => ({ camera: view.camera, names: view.ids.map(name) })) } : {}),
        });
      } else match.record({ type: 'bell', t: h.t, by: name(h.id) });
    }
    happeningsRecorded = world.happenings.length;
    for (const incident of world.incidents.slice(incidentsRecorded)) {
      match.record({
        type: 'nap',
        t: incident.t,
        by: name(incident.byId),
        target: name(incident.targetId),
        room: incident.room,
        witnesses: incident.witnesses.map((w) => ({ name: name(w.id), sawWho: w.sawWho, ...(w.camera ? { camera: w.camera } : {}) })),
      });
    }
    incidentsRecorded = world.incidents.length;
  };

  /** 使わないことになった答えを待って捨てる（応答は記録に残っている）。利用枠切れだけは見逃さない。 */
  const discard = async (ids: readonly PlayerId[]) => {
    for (const id of ids) {
      const waiting = pending.get(id);
      if (!waiting) continue;
      pending.delete(id);
      const settled = await waiting.answer;
      if (!settled.ok && settled.error instanceof QuotaExhaustedError) throw settled.error;
    }
  };

  try {
    if (options.ceremonies) await conductCeremony(world, match, 'greet', GREET_TURN, null);
    match.record({ type: 'round_start', t: world.clock, round: world.round, ...tasks() });
    while (world.stage !== 'over') {
      // 1) 適用の時刻が来た意図を適用する。答えがまだなら、ここで待つ（時間は進めない）
      const due = awakeIds(world).filter((id) => (pending.get(id)?.dueTick ?? Infinity) <= world.tick);
      for (const id of tickOrder(world, due)) {
        if (world.stage !== 'roam') break; // 先に適用された通報で集会が始まった。残りは使わない
        const waiting = pending.get(id) as Pending;
        pending.delete(id);
        const settled = await waiting.answer;
        if (!settled.ok) throw settled.error;
        const { intent } = settled.result;
        let note: string | null = null;
        // 声は行動より先に出す（行動が断られても、言ったことは聞こえている）
        const spoke = intent.say.trim().length > 0 && speakAloud(world, id, intent.say);
        try {
          applyRoamIntent(world, id, intent);
        } catch (error) {
          if (!(error instanceof RuleViolation)) throw error;
          // 決めた時から状況が変わっていた。理由は本人にだけ返す
          note = error.message;
          noteRejection(world, id, note);
        }
        match.applied(world.tick, id, settled.result, note ?? undefined);
        match.record({ type: 'decide', t: world.clock, agent: name(id), action: intent.action, target: intent.target, thought: intent.thought, ...(spoke ? { say: intent.say.trim() } : {}), source: settled.result.source, brain: match.agentOf(id).brainId, latencyMs: latencyOf(settled.result), applied: note === null, note });
      }

      if (world.stage === 'roam') {
        // 2) 起きている全員に観測を渡す。判断のきっかけは、本人の観測の列だけから決まる
        for (const id of awakeIds(world)) {
          const agent = match.agentOf(id);
          const obs = buildRoamObservation(world, id);
          agent.perceive(obs);
          // 開店までに適用できない判断は聞かない（呼び出しの無駄になる）。全員に見えている時刻だけで決まる
          if (world.tick + delayTicks >= totalTicks) continue;
          if (pending.has(id) || agent.wantsToDecide(obs) === null) continue;
          const answer = agent.actRoam(obs, match.hooksFor(world.tick, obs.self.name)).then(
            (result): Settled => ({ ok: true, result }),
            (error: unknown): Settled => ({ ok: false, error }),
          );
          pending.set(id, { dueTick: world.tick + delayTicks, answer });
        }

        // 3) 時間を1刻み進める。餅になった人が出していた意図は使わない
        snapshot();
        stepRoam(world);
        recordIncidents();
        await discard([...pending.keys()].filter((id) => playerById(world, id).status !== 'awake'));
      }

      if (world.stage === 'meeting') {
        // 4) 集会。まだ適用されていない意図は捨て、出席者に最後の観測を渡してから始める
        snapshot();
        recordIncidents();
        await discard([...pending.keys()]);
        const { meeting, found } = world;
        for (const id of meeting.seats) match.agentOf(id).perceive(buildRoamObservation(world, id));
        match.record({
          type: 'meeting_start',
          t: world.clock,
          meeting: meeting.index,
          kind: found ? 'report' : 'bell',
          reason: meeting.reason,
          reporter: name(meeting.reporterId),
          found: found ? name(found.id) : null,
          room: found?.room ?? null,
          attendees: meeting.seats.map(name),
          absent: meeting.absent.map((a) => ({ name: name(a.id), status: a.status })),
        });
        await conductMeeting(world, match, world.tick);
        endMeeting(world);
        // 勝敗が決まらなければ、次の見回りが始まっている
        if ((world.stage as RoamWorld['stage']) === 'roam') match.record({ type: 'round_start', t: world.clock, round: world.round, ...tasks() });
      }
    }

    snapshot();
    recordIncidents();
    await discard([...pending.keys()]);
    const result = world.result;
    if (!result) throw new Error('勝敗が決まらないまま試合が終わりました');
    match.record({ type: 'game_over', t: world.clock, winner: result.winner, why: result.why, ...(result.stolenFrom ? { stolenFrom: result.stolenFrom } : {}), ...tasks() });
    match.log.result = { ...result, clock: world.clock, rounds: world.round, meetings: world.meeting.index };
    if (options.ceremonies && options.afterTalk) {
      // ここからは試合のあと。結果と全員の役職を明かしてから、日記を書き、感想会で話す
      const told = `${SIDE_LABEL[result.winner]}の勝ち（${WHY_LABEL[result.why]}）`;
      const next = await conductCeremony(world, match, 'diary', AFTER_TURN, told);
      await conductCeremony(world, match, 'review', next, told);
    }
  } catch (error) {
    if (!(error instanceof QuotaExhaustedError)) throw error;
    // 利用枠が尽きたら止めて保存する。台本での代用や、有料の経路への切り替えはしない
    match.log.status = error instanceof CallLimitError ? 'stopped_limit' : 'stopped_quota';
    match.log.stopped = error.message;
    await Promise.all([...pending.values()].map((waiting) => waiting.answer));
  }
  return match.close();
}
