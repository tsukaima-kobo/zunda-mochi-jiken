// 真の状態からエージェントへ情報が渡る、ただ1つの経路。
// ここで返す値に入れてよいのは、本人が知覚できたことと、全員に公開されたことだけ。

import { NO_SUSPECT, SKIP_VOTE } from '../../protocol/src/index.ts';
import type { MeetingObservation } from '../../protocol/src/index.ts';
import { endgameOutlook } from './endgame.ts';
import { alliesOf, castOf, foxesOutOf, nameOf, playerById } from './world.ts';
import type { MeetingWorld, PlayerId, PlayerTruth } from './world.ts';

/**
 * 「ここで誰もクビにならないと、従業員が勝てなくなる」局面か（endgame.ts の読み。人数だけの全探索で確かめてある）。
 * 起きている人数が、クビにしないといけない相手（人狼と、まだ起きているかもしれない妖狐）の人数×2＋1 以下の時（人狼が2人以上いる間は、見回り1回で2人が餅になることがあるので、人狼の数−1だけ多く見る）。
 */
export function lastChanceOf(awake: number, fairiesLeft: number, foxUp: number): boolean {
  return fairiesLeft > 0 && endgameOutlook(awake, fairiesLeft, foxUp > 0, 'each').meeting === 'last';
}

/** 集会の局面（全員に公開された情報だけ）。 */
export function stakesOf(awake: number, fairiesLeft: number, foxUp: number): NonNullable<MeetingObservation['stakes']> {
  return {
    awake,
    fairiesLeft,
    lastChance: lastChanceOf(awake, fairiesLeft, foxUp),
    ...(foxUp > 0 ? { foxUp: true } : {}),
    ...(fairiesLeft > 0 && endgameOutlook(awake, fairiesLeft, foxUp > 0, 'one').meeting === 'last' ? { skipFatal: true } : {}),
  };
}

export function buildObservation(world: MeetingWorld, agentId: PlayerId): MeetingObservation {
  const me = playerById(world, agentId);
  const { meeting, config } = world;
  if (!meeting.seats.includes(agentId)) throw new Error('会議に出ていない人の観測は作れません');
  if (meeting.phase === 'done') throw new Error('会議は終わっています');

  // 人狼どうしは互いを知る。狂信者は、誰が人狼かを知っている（人狼は、誰が狂信者かを知らない）。従業員には、誰の役職も渡さない（人数だけは全員が知っている）。
  const allies = alliesOf(world, me.role, agentId);

  // 候補は席順（全員が見ている並び）で、本人を除く。役職や生成順で並べない。
  const others = meeting.seats.filter((id) => id !== agentId).map((id) => nameOf(world, id));

  // 局面: 人狼の人数（全員が知っている）から、「人狼だった」と公表された人（クビになった人狼）を引く。どちらも公開の情報
  const cast = castOf(world);
  const fairiesLeft = cast.nibblers - world.players.filter((p) => p.status === 'sent_home' && p.role === 'nibbler').length;
  const awake = meeting.seats.length;
  const foxUp = Math.max(0, (cast.foxes ?? 0) - (foxesOutOf(world).foxesOut ?? 0));

  return {
    kind: 'meeting',
    phase: meeting.phase,
    self: { name: me.name, role: me.role, persona: me.persona, style: me.style, allies, bonds: me.bonds ?? [], ...(me.role === 'seer' ? { divined: [...(me.divined ?? [])] } : {}), ...(me.role === 'fox' && me.foxWork ? { foxWork: { ...me.foxWork } } : {}) },
    facts: [...me.facts],
    ...foxesOutOf(world),
    history: [...world.history],
    cast,
    // 妖狐がまだ起きているかもしれない時（顔ぶれの妖狐の数から、「妖狐だった」と公表された人を引いた数。どちらも公開の情報）は、妖狐も、クビにしないといけない相手に数える。
    stakes: stakesOf(awake, fairiesLeft, foxUp),
    meeting: {
      reason: meeting.reason,
      absent: meeting.absent.map((a) => ({ name: nameOf(world, a.id), status: a.status })),
      round: meeting.round,
      maxRounds: config.maxRounds,
      attendees: meeting.seats.map((id) => nameOf(world, id)),
      transcript: meeting.transcript.map((line) => ({
        round: line.round,
        speaker: nameOf(world, line.speakerId),
        text: line.text,
      })),
    },
    options: [...others, meeting.phase === 'speak' ? NO_SUSPECT : SKIP_VOTE],
    // 話すことがなければ黙ってよい（集会の最初の発言は黙れない）。全員に同じ決まりで、本人の役職では変わらない
    ...(meeting.phase === 'speak' && config.allowPass && meeting.transcript.length > 0 ? { mayPass: true } : {}),
    limits: { sayTargetChars: config.sayTargetChars, sayMaxChars: config.sayMaxChars },
  };
}

/** 朝礼・日記・感想会。集会の外で、全員が名簿順にひとことずつ話す（日記は、ほかの人の分を見ない）。 */
export type CeremonyPhase = 'greet' | 'diary' | 'review';

const STATUS_LABEL: Record<PlayerTruth['status'], string> = { awake: '最後まで起きていた', asleep: 'ずんだ餅になった', sent_home: 'クビになった' };

/**
 * 朝礼・日記・感想会の観測。
 * greet（最初の見回りの前）: 試合の秘密は、本人の役職と仲間だけ。並びと人数は全員が知っている。
 * diary / review（試合のあと）: 結果と全員の役職を明かす（もう試合に影響しない）。
 * spoken は、この場でここまでに話された言葉（日記では渡さない）。
 */
export function buildCeremonyObservation(
  world: MeetingWorld,
  agentId: PlayerId,
  phase: CeremonyPhase,
  spoken: readonly { speakerId: PlayerId; text: string }[],
  result: string | null,
): MeetingObservation {
  const me = playerById(world, agentId);
  const after = phase !== 'greet';
  if (after && result === null) throw new Error('試合のあとの観測には、結果が要ります');
  if (!after && result !== null) throw new Error('朝礼の観測に、結果を入れてはいけません');
  const allies = alliesOf(world, me.role, agentId);
  const transcript = phase === 'diary' ? [] : spoken.map((line) => ({ round: 1, speaker: nameOf(world, line.speakerId), text: line.text }));
  return {
    kind: 'meeting',
    phase,
    self: { name: me.name, role: me.role, persona: me.persona, style: me.style, allies, bonds: me.bonds ?? [] },
    facts: after ? [...me.facts] : [],
    history: [...world.history],
    cast: castOf(world),
    meeting: {
      reason: phase === 'greet' ? '朝礼' : phase === 'diary' ? '日記' : '感想会',
      absent: [],
      round: 1,
      maxRounds: 1,
      attendees: world.roster.map((id) => nameOf(world, id)),
      transcript,
    },
    options: [NO_SUSPECT],
    reveal: after
      ? { result: result as string, roles: world.roster.map((id) => playerById(world, id)).map((p) => ({ name: p.name, role: p.role, status: STATUS_LABEL[p.status] })) }
      : null,
    // 日記は少し長く書ける
    limits:
      phase === 'diary'
        ? { sayTargetChars: world.config.sayTargetChars * 2, sayMaxChars: world.config.sayMaxChars * 2 }
        : { sayTargetChars: world.config.sayTargetChars, sayMaxChars: world.config.sayMaxChars },
  };
}

/** 観測に出てきた表示名を、進行役が内部の ID に戻す。出席者以外は null。 */
export function seatIdByName(world: MeetingWorld, name: string): PlayerId | null {
  return world.meeting.seats.find((id) => nameOf(world, id) === name) ?? null;
}
