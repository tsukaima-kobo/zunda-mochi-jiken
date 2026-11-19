// 会議だけの形の「会議の前に何があったか」を種から作る。
// マップも移動もまだ無いので、時刻ごとの居場所を抽象的に決め、
// そこから各自の「見聞きしたこと」を作る。見回りのある試合では、実際の移動に置き換わる。

import { bondsOf, CAST } from '../../protocol/src/index.ts';
import type { Role } from '../../protocol/src/index.ts';
import { createRng } from './rng.ts';
import { DEFAULT_MEETING_CONFIG } from './world.ts';
import type { MeetingConfig, PlayerId, PlayerTruth, World } from './world.ts';

// 登場人物は packages/protocol/src/cast.ts の前から8人。
// 乱数の使い方は、仮の名前だったころと同じに保つ（人柄を並べ替えていた所も、空で回す）。
const MEMBERS = CAST.slice(0, 8);
const NAMES = MEMBERS.map((member) => member.name);
const ROOMS = ['蒸し場', '倉庫', '店先', '休憩室', 'あんこ場'];
const SLOTS = ['02:00', '02:20', '02:40', '03:00'];

export interface ScenarioOptions {
  seed: number;
  /** 会議に出る人数。ずんだ餅に変えられる1人は別に用意する。 */
  attendees?: number;
  config?: Partial<MeetingConfig>;
}

export function createWorld(options: ScenarioOptions): World {
  const attendees = options.attendees ?? 4;
  if (attendees < 3 || attendees + 1 > NAMES.length) {
    throw new Error(`出席者は 3〜${NAMES.length - 1} 人にしてください`);
  }
  const rng = createRng(options.seed);
  const config = { ...DEFAULT_MEETING_CONFIG, ...options.config };

  const names = rng.shuffle(NAMES).slice(0, attendees + 1);
  rng.shuffle(MEMBERS); // 前は、ここで人柄を並べ替えていた
  const ids: PlayerId[] = names.map((_, i) => `p${i + 1}`);

  const nibblerId = rng.pick(ids);
  const victimId = rng.pick(ids.filter((id) => id !== nibblerId));
  const reporterId = rng.pick(ids.filter((id) => id !== nibblerId && id !== victimId));

  const last = SLOTS.length - 1;
  const deedSlot = 1 + rng.int(last - 1); // 最初でも最後でもない時刻
  const deedRoom = rng.pick(ROOMS);
  const elsewhere = ROOMS.filter((room) => room !== deedRoom);

  // 時刻ごとの居場所。事件の部屋には、事件の時刻は犯人と被害者だけ、
  // その後は被害者だけ、最後の時刻に通報者が入る。
  const timeline: Record<PlayerId, string[]> = {};
  for (const id of ids) {
    timeline[id] = SLOTS.map((_, slot) => {
      if (id === victimId) return slot >= deedSlot ? deedRoom : rng.pick(ROOMS);
      if (id === nibblerId && slot === deedSlot) return deedRoom;
      if (id === reporterId && slot === last) return deedRoom;
      return slot >= deedSlot ? rng.pick(elsewhere) : rng.pick(ROOMS);
    });
  }

  const nameById = new Map(ids.map((id, i) => [id, names[i] as string]));
  const victimName = nameById.get(victimId) as string;
  const roomAt = (id: PlayerId, slot: number) => (timeline[id] as string[])[slot] as string;

  const factsFor = (id: PlayerId): string[] =>
    SLOTS.map((time, slot) => {
      const room = roomAt(id, slot);
      if (id === nibblerId && slot === deedSlot) {
        return `${time} ${room}で ${victimName} をこっそりずんだ餅に変えた。ほかには誰もいなかった`;
      }
      if (id === reporterId && slot === last) {
        return `${time} ${room}で ずんだ餅になった ${victimName} を見つけて、会議を呼んだ`;
      }
      // 一緒にいたと分かるのは、同じ部屋にいて、その時刻に起きていた相手だけ
      const companions = ids
        .filter((other) => other !== id && roomAt(other, slot) === room)
        .filter((other) => other !== victimId || slot < deedSlot)
        .map((other) => nameById.get(other) as string);
      return companions.length > 0
        ? `${time} ${room}で ${companions.join('、')} と一緒だった`
        : `${time} ${room}にひとりでいた`;
    });

  const players: PlayerTruth[] = ids.map((id, i) => {
    const role: Role = id === nibblerId ? 'nibbler' : 'artisan';
    return {
      id,
      name: names[i] as string,
      role,
      persona: MEMBERS.find((member) => member.name === names[i])?.persona ?? '',
      style: MEMBERS.find((member) => member.name === names[i])?.style ?? '',
      bonds: bondsOf(names[i] as string, names),
      status: id === victimId ? 'asleep' : 'awake',
      facts: id === victimId ? [] : factsFor(id),
    };
  });

  const seats = rng.shuffle(ids.filter((id) => id !== victimId));
  const reporterName = nameById.get(reporterId) as string;

  return {
    seed: options.seed,
    config,
    players,
    roster: seats,
    history: [],
    meeting: {
      index: 1,
      absent: [{ id: victimId, status: 'asleep' }],
      reason: `${reporterName} が ${deedRoom} で、ずんだ餅になった ${victimName} を見つけた`,
      reporterId,
      seats,
      round: 1,
      phase: 'speak',
      // 第1巡は通報者から。残りは席順
      queue: [reporterId, ...seats.filter((id) => id !== reporterId)],
      transcript: [],
      outcome: null,
    },
    truth: { nibblerId, victimId, deedTime: SLOTS[deedSlot] as string, deedRoom, timeline },
  };
}
