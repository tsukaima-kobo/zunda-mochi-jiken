// 会議の進行ルール。発言順と票の集計は、全員に見えている情報だけで決める。

import { charCount, nameOf, RuleViolation } from './world.ts';
import type { Ballot, MeetingOutcome, PlayerId, SpokenLine, MeetingWorld } from './world.ts';

export function currentSpeaker(world: MeetingWorld): PlayerId | null {
  return world.meeting.phase === 'speak' ? (world.meeting.queue[0] ?? null) : null;
}

/**
 * 第2巡以降の発言順。前の巡の発言で名前を出された回数が多い人から。同数は席順。
 * 入力は公開の発言と席順だけ（非公開の「疑い先」は使わない。使うと順番から他人の内心が漏れる）。
 */
export function priorityOrder(
  seats: readonly PlayerId[],
  previousRound: readonly SpokenLine[],
  nameById: (id: PlayerId) => string,
): PlayerId[] {
  const mentions = new Map<PlayerId, number>(seats.map((id) => [id, 0]));
  for (const line of previousRound) {
    for (const id of seats) {
      if (id !== line.speakerId && line.text.includes(nameById(id))) {
        mentions.set(id, (mentions.get(id) ?? 0) + 1);
      }
    }
  }
  return [...seats].sort((a, b) => (mentions.get(b) ?? 0) - (mentions.get(a) ?? 0) || seats.indexOf(a) - seats.indexOf(b));
}

export function applySpeak(world: MeetingWorld, speakerId: PlayerId, text: string): void {
  const { meeting, config } = world;
  if (meeting.phase !== 'speak') throw new RuleViolation('not_speaking_phase', 'いまは発言の時間ではありません');
  if (meeting.queue[0] !== speakerId) throw new RuleViolation('not_your_turn', 'あなたの番ではありません');
  const say = text.trim();
  if (say.length === 0) throw new RuleViolation('empty', '発言が空です');
  if (charCount(say) > config.sayMaxChars) {
    throw new RuleViolation('too_long', `発言は${config.sayMaxChars}字以内にしてください`);
  }

  meeting.transcript.push({ round: meeting.round, speakerId, text: say });
  meeting.queue.shift();
  if (meeting.queue.length > 0) return;

  if (meeting.round < config.maxRounds) {
    const previous = meeting.transcript.filter((line) => line.round === meeting.round);
    meeting.round += 1;
    meeting.queue = priorityOrder(meeting.seats, previous, (id) => nameOf(world, id));
  } else {
    meeting.phase = 'vote';
  }
}

/**
 * 票の集計。クビにするのは、最多が1人だけ・2票以上・棄権より多い、の全部を満たすときだけ。
 */
export function resolveBallots(seats: readonly PlayerId[], ballots: Readonly<Record<PlayerId, Ballot>>): MeetingOutcome {
  const counts = new Map<Ballot, number>();
  for (const voter of seats) {
    const ballot = ballots[voter];
    if (ballot === undefined) throw new RuleViolation('missing_ballot', '全員の票が揃っていません');
    counts.set(ballot, (counts.get(ballot) ?? 0) + 1);
  }
  const order = (target: Ballot) => (target === 'skip' ? seats.length : seats.indexOf(target));
  const tally = [...counts.entries()]
    .map(([target, count]) => ({ target, count }))
    .sort((a, b) => b.count - a.count || order(a.target) - order(b.target));

  const skip = counts.get('skip') ?? 0;
  const named = tally.filter((row) => row.target !== 'skip');
  const top = named[0];
  if (!top || top.count < 2) return { tally, ejectedId: null, verdict: 'too_few' };
  if (named[1] && named[1].count === top.count) return { tally, ejectedId: null, verdict: 'tie' };
  if (top.count <= skip) return { tally, ejectedId: null, verdict: 'skip_wins' };
  return { tally, ejectedId: top.target, verdict: 'ejected' };
}

/** 全員の票を同時に受け取って確定する（1人ずつ適用しない。途中経過を誰にも見せないため）。 */
export function applyBallots(world: MeetingWorld, ballots: Readonly<Record<PlayerId, Ballot>>): MeetingOutcome {
  const { meeting } = world;
  if (meeting.phase !== 'vote') throw new RuleViolation('not_voting_phase', 'いまは投票の時間ではありません');
  for (const voter of meeting.seats) {
    const ballot = ballots[voter];
    if (ballot === undefined) throw new RuleViolation('missing_ballot', '全員の票が揃っていません');
    if (ballot === voter) throw new RuleViolation('self_vote', '自分には投票できません');
    if (ballot !== 'skip' && !meeting.seats.includes(ballot)) {
      throw new RuleViolation('unknown_target', '出席していない相手には投票できません');
    }
  }
  // 誰が誰に入れたかは、投票のあとで全員に明かす（次の集会からの手がかりになる）
  const outcome: MeetingOutcome = { ...resolveBallots(meeting.seats, ballots), ballots: Object.fromEntries(meeting.seats.map((id) => [id, ballots[id] as Ballot])) };
  meeting.outcome = outcome;
  meeting.phase = 'done';
  return outcome;
}
