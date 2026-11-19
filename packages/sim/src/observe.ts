// 真の状態からエージェントへ情報が渡る、ただ1つの経路。
// ここで返す値に入れてよいのは、本人が知覚できたことと、全員に公開されたことだけ。

import { NO_SUSPECT, SKIP_VOTE } from '../../protocol/src/index.ts';
import type { MeetingObservation } from '../../protocol/src/index.ts';
import { castOf, nameOf, playerById } from './world.ts';
import type { MeetingWorld, PlayerId, PlayerTruth } from './world.ts';

export function buildObservation(world: MeetingWorld, agentId: PlayerId): MeetingObservation {
  const me = playerById(world, agentId);
  const { meeting, config } = world;
  if (!meeting.seats.includes(agentId)) throw new Error('会議に出ていない人の観測は作れません');
  if (meeting.phase === 'done') throw new Error('会議は終わっています');

  // 妖精どうしだけが互いを知る。従業員と妖精びいきには、誰の役職も渡さない（人数だけは全員が知っている）。
  const allies =
    me.role === 'nibbler'
      ? world.players.filter((p) => p.role === 'nibbler' && p.id !== agentId).map((p) => p.name)
      : [];

  // 候補は席順（全員が見ている並び）で、本人を除く。役職や生成順で並べない。
  const others = meeting.seats.filter((id) => id !== agentId).map((id) => nameOf(world, id));

  // 局面: 妖精の人数（全員が知っている）から、「妖精だった」と公表された人（クビになった妖精）を引く。どちらも公開の情報
  const cast = castOf(world);
  const fairiesLeft = cast.nibblers - world.players.filter((p) => p.status === 'sent_home' && p.role === 'nibbler').length;
  const awake = meeting.seats.length;

  return {
    kind: 'meeting',
    phase: meeting.phase,
    self: { name: me.name, role: me.role, persona: me.persona, style: me.style, allies, bonds: me.bonds ?? [] },
    facts: [...me.facts],
    history: [...world.history],
    cast,
    stakes: { awake, fairiesLeft, lastChance: fairiesLeft > 0 && awake <= fairiesLeft * 2 + 1 },
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
  const allies = me.role === 'nibbler' ? world.players.filter((p) => p.role === 'nibbler' && p.id !== agentId).map((p) => p.name) : [];
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
