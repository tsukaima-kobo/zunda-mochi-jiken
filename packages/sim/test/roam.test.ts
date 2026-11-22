import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  actorById,
  applyBallots,
  applyRoamIntent,
  applySpeak,
  areaAt,
  awakeIds,
  buildObservation,
  buildRoamObservation,
  centerOf,
  createRoamWorld,
  currentSpeaker,
  endMeeting,
  findPath,
  hasLineOfSight,
  isWalkable,
  nameOf,
  parseMap,
  playerById,
  speakAloud,
  startMeeting,
  stepRoam,
  tileOf,
  visibleTo,
} from '../src/index.ts';
import type { Ballot, MapDefinition, PlayerId, RoamWorld } from '../src/index.ts';

const mapDef = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../content/maps/workshop-small.json'), 'utf8')) as MapDefinition;
const map = parseMap(mapDef);
const world = (seed = 1, roam: Partial<RoamWorld['roam']> = {}, players = 5) => createRoamWorld({ seed, map: mapDef, players, roam });
const run = (w: RoamWorld, ticks: number) => {
  for (let i = 0; i < ticks; i++) stepRoam(w);
};
const name = (w: RoamWorld, id: PlayerId) => nameOf(w, id);

/** 決まった場所に並べる。nibbler と victim は倉庫の奥でふたりきり、残りは店先（倉庫からは見えない）。 */
function stage(seed = 1, roam: Partial<RoamWorld['roam']> = {}, players = 5) {
  const w = world(seed, { napCooldown: 0, ...roam }, players);
  const nibbler = w.truth.nibblerIds[0] as PlayerId;
  const artisans = w.roster.filter((id) => id !== nibbler);
  const [victim, ...rest] = artisans as [PlayerId, ...PlayerId[]];
  w.napReadyAt[nibbler] = 0;
  actorById(w, nibbler).pos = centerOf({ x: 20, y: 2 });
  actorById(w, victim).pos = centerOf({ x: 21, y: 2 });
  rest.forEach((id, i) => (actorById(w, id).pos = centerOf({ x: 2 + i, y: 11 })));
  return { w, nibbler, victim, rest };
}

/** 集会を、決めた票で最後まで進める。 */
function hold(w: RoamWorld, votes: (voter: PlayerId) => Ballot) {
  for (let speaker = currentSpeaker(w); speaker !== null; speaker = currentSpeaker(w)) applySpeak(w, speaker, '見たことを話すね。');
  applyBallots(w, Object.fromEntries(w.meeting.seats.map((id) => [id, votes(id)])));
  endMeeting(w);
}

describe('マップ', () => {
  it('部屋が4つあり、どの部屋からどの部屋へも道がある', () => {
    expect(map.roomNames).toEqual(['蒸し場', '倉庫', '店先', '休憩室']);
    for (const from of map.roomNames) {
      for (const to of map.roomNames) {
        const route = findPath(map, map.roomTiles[from]![0]!, map.roomTiles[to]![0]!);
        expect(route, `${from} → ${to}`).not.toBeNull();
        for (const point of route ?? []) expect(isWalkable(map, Math.floor(point.x), Math.floor(point.y))).toBe(true);
      }
    }
  });

  it('壁の中へは行けない。行の長さが違うマップは受け付けない', () => {
    expect(findPath(map, { x: 1, y: 1 }, { x: 0, y: 0 })).toBeNull();
    expect(() => parseMap({ ...mapDef, rows: ['###', '#.'] })).toThrow();
    expect(() => parseMap({ ...mapDef, spawn: [[0, 0]] })).toThrow(/壁/);
  });

  it('壁をはさんだ相手は見えない。同じ部屋の相手は見える', () => {
    const inSteam = centerOf({ x: 2, y: 2 });
    expect(hasLineOfSight(map, inSteam, centerOf({ x: 6, y: 4 }))).toBe(true);
    expect(hasLineOfSight(map, inSteam, centerOf({ x: 2, y: 10 }))).toBe(false); // 蒸し場 → 店先
    expect(hasLineOfSight(map, centerOf({ x: 7, y: 1 }), centerOf({ x: 9, y: 1 }))).toBe(false); // 壁1枚をはさんだ隣
    expect(areaAt(map, inSteam)).toBe('蒸し場');
    expect(areaAt(map, centerOf({ x: 11, y: 6 }))).toBe('通路');
  });
});

describe('歩き回り', () => {
  it('部屋へ向かうと、道をたどって着き、結果が本人に返る', () => {
    const w = world();
    const id = w.roster[0]!;
    applyRoamIntent(w, id, { action: 'move_to', target: '倉庫' });
    expect(buildRoamObservation(w, id)).toMatchObject({ activity: '倉庫 へ向かっている', idle: false, lastResult: null });
    run(w, 60);
    expect(areaAt(w.map, actorById(w, id).pos)).toBe('倉庫');
    expect(buildRoamObservation(w, id)).toMatchObject({ where: '倉庫', idle: true, lastResult: '倉庫 に着いた' });
  });

  it('歩く速さは一定で、壁を通り抜けない', () => {
    const w = world(3);
    const id = w.roster[0]!;
    applyRoamIntent(w, id, { action: 'move_to', target: '店先' });
    let before = { ...actorById(w, id).pos };
    for (let i = 0; i < 80; i++) {
      stepRoam(w);
      const now = actorById(w, id).pos;
      expect(Math.hypot(now.x - before.x, now.y - before.y)).toBeLessThanOrEqual(w.roam.speed * w.roam.tickSeconds + 1e-9);
      expect(isWalkable(w.map, tileOf(now).x, tileOf(now).y)).toBe(true);
      before = { ...now };
    }
  });

  it('できない行動は、本人の入力から分かる理由で断る', () => {
    const { w, nibbler, victim, rest } = stage();
    const far = rest[0]!;
    expect(() => applyRoamIntent(w, far, { action: 'move_to', target: '屋根裏' })).toThrow(/その名前の部屋はありません/);
    expect(() => applyRoamIntent(w, far, { action: 'fly', target: 'なし' })).toThrow(/その行動はできません/);
    expect(() => applyRoamIntent(w, far, { action: 'follow', target: name(w, victim) })).toThrow(/いま見えていません/);
    // 起きている人は知らせられない。見えていない人も知らせられない
    expect(() => applyRoamIntent(w, nibbler, { action: 'report', target: name(w, victim) })).toThrow(/いま見えていません/);
    // 従業員がずんだ餅に変えようとしても、知らない行動と同じ断り方になる（役職の手がかりにしない）
    expect(() => applyRoamIntent(w, victim, { action: 'transform', target: name(w, nibbler) })).toThrow(/その行動はできません/);
  });

  it('ついていく相手を見失うと、やめて、結果が本人に返る', () => {
    const w = world(2);
    const [a, b] = w.roster as [PlayerId, PlayerId];
    applyRoamIntent(w, a, { action: 'follow', target: name(w, b) });
    actorById(w, b).pos = centerOf({ x: 20, y: 11 }); // 見えない所（休憩室の奥）へ移す
    run(w, 15);
    expect(buildRoamObservation(w, a)).toMatchObject({ idle: true, lastResult: `${name(w, b)} を見失った` });
  });

  it('同じ種と同じ意図の列なら、同じ動きになる', () => {
    const play = () => {
      const w = world(5);
      w.roster.forEach((id, i) => applyRoamIntent(w, id, { action: 'move_to', target: w.map.roomNames[i % 4]! }));
      run(w, 40);
      return w;
    };
    expect(play()).toEqual(play());
  });
});

describe('ずんだ餅に変える', () => {
  it('妖精は近くの相手をずんだ餅に変える。餅になった人は動かず、まわりからは「ずんだ餅になっている」と見える', () => {
    const { w, nibbler, victim } = stage();
    applyRoamIntent(w, nibbler, { action: 'transform_if_unseen', target: name(w, victim) });
    run(w, 3);
    expect(playerById(w, victim).status).toBe('asleep');
    expect(w.incidents).toEqual([{ t: 0.2, round: 1, byId: nibbler, targetId: victim, room: '倉庫', witnesses: [] }]);
    expect(buildRoamObservation(w, nibbler)).toMatchObject({
      idle: true,
      lastResult: `${name(w, victim)} をずんだ餅に変えた`,
      visible: [{ name: name(w, victim), where: '倉庫', asleep: true }],
      napCooldown: 0,
    });
    expect(() => buildRoamObservation(w, victim)).toThrow();
    expect(() => applyRoamIntent(w, victim, { action: 'wait', target: 'なし' })).toThrow(/いまは動けません/);
    expect(() => applyRoamIntent(w, nibbler, { action: 'follow', target: name(w, victim) })).toThrow(/もうずんだ餅になっています/);
  });

  it('次に渡せるまで間があり、見回りの初めにも同じだけ待つ', () => {
    const { w, nibbler, victim } = stage(1, { napCooldown: 10 });
    w.napReadyAt[nibbler] = 10;
    applyRoamIntent(w, nibbler, { action: 'transform', target: name(w, victim) });
    run(w, 49);
    expect(playerById(w, victim).status).toBe('awake');
    expect(buildRoamObservation(w, nibbler).napCooldown).toBe(1);
    expect(buildRoamObservation(w, victim).napCooldown).toBeNull(); // 従業員には見せない
    run(w, 1);
    expect(playerById(w, victim).status).toBe('asleep');
    expect(buildRoamObservation(w, nibbler).napCooldown).toBe(10);
  });

  it('「見られていない時だけ」は、ほかの人の目があるあいだ待つ。機会がなければあきらめる', () => {
    const { w, nibbler, victim, rest } = stage();
    const watcher = rest[0]!;
    actorById(w, watcher).pos = centerOf({ x: 17, y: 3 }); // 同じ倉庫の中
    applyRoamIntent(w, nibbler, { action: 'transform_if_unseen', target: name(w, victim) });
    run(w, 20);
    expect(playerById(w, victim).status).toBe('awake');
    actorById(w, watcher).pos = centerOf({ x: 2, y: 11 }); // 出ていった
    run(w, 1);
    expect(playerById(w, victim).status).toBe('asleep');

    const second = stage(2);
    actorById(second.w, second.rest[0]!).pos = centerOf({ x: 17, y: 3 });
    applyRoamIntent(second.w, second.nibbler, { action: 'transform_if_unseen', target: name(second.w, second.victim) });
    run(second.w, 70);
    expect(playerById(second.w, second.victim).status).toBe('awake');
    expect(buildRoamObservation(second.w, second.nibbler).lastResult).toBe(`${name(second.w, second.victim)} をずんだ餅に変える機会がなかった`);
  });

  it('ついていく相手が見えない所で餅に変わっても、本人の観測は、変わらなかった場合と同じ', () => {
    // 同じ場面を2つ作り、片方でだけ、見えない所で餅に変わる
    const play = (withNap: boolean) => {
      const { w, nibbler, victim, rest } = stage();
      const follower = rest[0]!;
      actorById(w, follower).pos = centerOf({ x: 17, y: 3 }); // 倉庫の中で、相手が見えている
      applyRoamIntent(w, follower, { action: 'follow', target: name(w, victim) });
      actorById(w, follower).pos = centerOf({ x: 2, y: 11 }); // 見えない所（店先）へ離れた
      actorById(w, follower).path = [];
      if (withNap) applyRoamIntent(w, nibbler, { action: 'transform', target: name(w, victim) });
      const seen = [];
      for (let i = 0; i < 20; i++) {
        stepRoam(w);
        seen.push(buildRoamObservation(w, follower));
      }
      return { seen, asleep: playerById(w, victim).status === 'asleep', victim: name(w, victim) };
    };
    const napped = play(true);
    const quiet = play(false);
    expect(napped.asleep).toBe(true);
    expect(quiet.asleep).toBe(false);
    expect(napped.seen).toEqual(quiet.seen);
    expect(napped.seen.at(-1)).toMatchObject({ idle: true, lastResult: `${napped.victim} を見失った` });
  });

  it('見ていた人には、見えた範囲のことだけが伝わる', () => {
    const { w, nibbler, victim, rest } = stage();
    const [both, onlyVictim, nobody] = rest as [PlayerId, PlayerId, PlayerId];
    actorById(w, both).pos = centerOf({ x: 17, y: 3 }); // 倉庫の中: 両方が見える
    // 餅に変わる人だけが見える位置: 妖精は離れたまま（距離の条件を外して）遠くから変えたことにする
    actorById(w, nibbler).pos = centerOf({ x: 21, y: 2 });
    actorById(w, victim).pos = centerOf({ x: 16, y: 3 });
    actorById(w, onlyVictim).pos = centerOf({ x: 11, y: 3 }); // 通路から戸口ごしに、餅に変わる人だけが見える（妖精は遠くて見えない）
    w.roam.napRange = 99;
    expect(visibleTo(w, onlyVictim)).toContain(victim);
    expect(visibleTo(w, onlyVictim)).not.toContain(nibbler);
    applyRoamIntent(w, nibbler, { action: 'transform', target: name(w, victim) });
    run(w, 1);
    const n = name(w, nibbler);
    const v = name(w, victim);
    expect(buildRoamObservation(w, both).events).toEqual([`倉庫 で ${n} が ${v} に手をかざし、${v} がずんだ餅に変わるのを見た`]);
    expect(buildRoamObservation(w, onlyVictim).events).toEqual([`倉庫 で ${v} が急にずんだ餅に変わるのを見た（そばに誰がいたかは見えなかった）`]);
    expect(buildRoamObservation(w, nobody).events).toEqual([]);
    expect(w.incidents[0]!.witnesses).toEqual(expect.arrayContaining([{ id: both, sawWho: true }, { id: onlyVictim, sawWho: false }]));
    // 出来事は、その瞬間の観測にだけ出る
    run(w, 1);
    expect(buildRoamObservation(w, both).events).toEqual([]);
  });
});

/** 知らせに向かった人が、餅のすぐそば（reportRange）に着いて、集会になるまで進める。着いた時の距離も確かめる。 */
function walkToReport(w: RoamWorld, finder: PlayerId, victim: PlayerId): void {
  const far = () => Math.hypot(actorById(w, finder).pos.x - actorById(w, victim).pos.x, actorById(w, finder).pos.y - actorById(w, victim).pos.y);
  expect(far()).toBeGreaterThan(w.roam.reportRange);
  for (let i = 0; i < 400 && w.stage === 'roam'; i++) stepRoam(w);
  expect(w.stage).toBe('meeting');
  expect(far()).toBeLessThanOrEqual(w.roam.reportRange);
}

describe('発見と集会', () => {
  it('餅のすぐそばにいれば、その場で知らせられる。知らせに向かう途中でほかの行動を選ぶと、知らせない', () => {
    const near = stage();
    applyRoamIntent(near.w, near.nibbler, { action: 'transform', target: name(near.w, near.victim) });
    run(near.w, 1);
    const spot = actorById(near.w, near.victim).pos;
    actorById(near.w, near.rest[0]!).pos = { x: spot.x + 1, y: spot.y };
    applyRoamIntent(near.w, near.rest[0]!, { action: 'report', target: name(near.w, near.victim) });
    expect(near.w.stage).toBe('meeting');

    const away = stage();
    applyRoamIntent(away.w, away.nibbler, { action: 'transform', target: name(away.w, away.victim) });
    run(away.w, 1);
    const finder = away.rest[0]!;
    actorById(away.w, finder).pos = centerOf({ x: 17, y: 3 });
    applyRoamIntent(away.w, finder, { action: 'report', target: name(away.w, away.victim) });
    applyRoamIntent(away.w, finder, { action: 'wait', target: 'なし' });
    run(away.w, 100);
    expect(away.w.stage).toBe('roam');
  });

  it('考え始めた時に見えていた餅なら、考えている間に通りすぎても知らせられる（見ていなければ知らせられない）', () => {
    const { w, nibbler, victim, rest } = stage();
    applyRoamIntent(w, nibbler, { action: 'transform', target: name(w, victim) });
    run(w, 1);
    const [finder, stranger] = [rest[0]!, rest[1]!];
    // finder はいま餅が見えていない。考え始めた時に見えていた（sawAsleep に入っている）なら、知らせられる
    expect(visibleTo(w, finder)).not.toContain(victim);
    expect(() => applyRoamIntent(w, stranger, { action: 'report', target: name(w, victim) }, { sawAsleep: [] })).toThrow(/いま見えていません/);
    applyRoamIntent(w, finder, { action: 'report', target: name(w, victim) }, { sawAsleep: [name(w, victim)] });
    // 2026-11-22 から、餅のすぐそばまで歩いてから知らせる（その場では、まだ集会にならない）
    expect(w.stage).toBe('roam');
    expect(buildRoamObservation(w, finder).activity).toContain('知らせに向かっている');
    walkToReport(w, finder, victim);
    expect(w.meeting.reporterId).toBe(finder);
    expect(w.found?.id).toBe(victim);
  });

  it('ずんだ餅になった人が見えていれば知らせられ、起きている全員が集まる', () => {
    const { w, nibbler, victim, rest } = stage();
    applyRoamIntent(w, nibbler, { action: 'transform', target: name(w, victim) });
    run(w, 1);
    const finder = rest[0]!;
    expect(() => applyRoamIntent(w, finder, { action: 'report', target: name(w, victim) })).toThrow(/いま見えていません/);
    actorById(w, finder).pos = centerOf({ x: 17, y: 3 });
    applyRoamIntent(w, finder, { action: 'report', target: name(w, victim) });
    // 見えているだけでは、まだ知らせられない。餅のすぐそばまで歩いた所で、集会になる
    expect(w.stage).toBe('roam');
    walkToReport(w, finder, victim);
    expect(w.meeting).toMatchObject({
      index: 1,
      reason: `${name(w, finder)} が 倉庫 で、ずんだ餅になった ${name(w, victim)} を見つけて、鐘を鳴らした`,
      absent: [{ id: victim, status: 'asleep' }],
      phase: 'speak',
    });
    expect(w.meeting.seats).toEqual(w.roster.filter((id) => id !== victim));
    expect(w.meeting.queue[0]).toBe(finder);
    // 集会の間は時間が進まず、歩き回りの行動もできない
    const clock = w.clock;
    run(w, 5);
    expect(w.clock).toBe(clock);
    expect(() => applyRoamIntent(w, finder, { action: 'wait', target: 'なし' })).toThrow(/歩き回る時間ではありません/);
    // 会議の観測には、来ていない人が入る
    expect(buildObservation(w, finder).meeting.absent).toEqual([{ name: name(w, victim), status: 'asleep' }]);
    expect(buildObservation(w, finder).options).not.toContain(name(w, victim));
  });

  it('妖精をクビにすれば、従業員の勝ち', () => {
    const { w, nibbler, victim } = stage();
    startAfterNap(w, nibbler, victim);
    hold(w, (voter) => (voter === nibbler ? 'skip' : nibbler));
    expect(w).toMatchObject({ stage: 'over', result: { winner: 'artisan', why: 'nibbler_sent_home' } });
    expect(playerById(w, nibbler).status).toBe('sent_home');
  });

  it('集会のあとは次の見回りになる。餅になった人とクビになった人は工房からいなくなり、経過が全員に残る', () => {
    const { w, nibbler, victim, rest } = stage(1, {}, 6);
    startAfterNap(w, nibbler, victim);
    const wrong = rest[0]!;
    hold(w, (voter) => (voter === wrong ? 'skip' : wrong));
    expect(w).toMatchObject({ stage: 'roam', round: 2, result: null });
    expect(awakeIds(w)).toEqual(w.roster.filter((id) => id !== victim && id !== wrong));
    const obs = buildRoamObservation(w, nibbler);
    expect(obs.round).toBe(2);
    expect(obs.away).toEqual(expect.arrayContaining([{ name: name(w, victim), status: 'asleep' }, { name: name(w, wrong), status: 'sent_home' }]));
    expect(obs.visible.map((v) => v.name)).not.toContain(name(w, victim));
    expect(obs.history).toHaveLength(1);
    expect(obs.history[0]).toContain(`${name(w, wrong)} をクビにした（妖精ではなかった）`);
    expect(obs.history[0]).toContain(`ずんだ餅になった人: ${name(w, victim)}`);
    // 誰が誰に入れたかは、投票のあとで全員に明かされる（席順）。役職の名前は残さない（妖精だったかどうかだけ）
    expect(obs.history[0]).toContain(`${name(w, wrong)}→スキップ`);
    expect(obs.history[0]).toContain(`${name(w, nibbler)}→${name(w, wrong)}`);
    expect(obs.history[0]).not.toMatch(/従業員|妖精マニア|ずんだの妖精/);
    // 見回りの初めは、また渡せるまで待つ
    expect(buildRoamObservation(w, nibbler).napCooldown).toBe(0); // この試験では待ち時間を 0 にしている
  });

  it('起きている人間が1人以下になれば、妖精の勝ち（餅に変えた瞬間でも、集会のあとでも）', () => {
    const byNap = stage(1, {}, 3);
    applyRoamIntent(byNap.w, byNap.nibbler, { action: 'transform', target: name(byNap.w, byNap.victim) });
    run(byNap.w, 1);
    expect(byNap.w).toMatchObject({ stage: 'over', result: { winner: 'nibbler', why: 'outnumbered' } });

    const byVote = stage(1, {}, 4);
    startAfterNap(byVote.w, byVote.nibbler, byVote.victim);
    const wrong = byVote.rest[0]!;
    hold(byVote.w, (voter) => (voter === wrong ? 'skip' : wrong));
    expect(byVote.w).toMatchObject({ stage: 'over', result: { winner: 'nibbler', why: 'outnumbered' } });
  });

  it('開店の時刻まで守りきれば、従業員の勝ち', () => {
    const w = world(1, { roamSeconds: 3 });
    run(w, 14);
    expect(w.stage).toBe('roam');
    run(w, 1);
    expect(w).toMatchObject({ stage: 'over', clock: 3, result: { winner: 'artisan', why: 'opened' } });
    const frozen = structuredClone(w);
    run(w, 5);
    expect(w).toEqual(frozen);
  });

  function startAfterNap(w: RoamWorld, nibbler: PlayerId, victim: PlayerId): void {
    applyRoamIntent(w, nibbler, { action: 'transform', target: name(w, victim) });
    run(w, 1);
    startMeeting(w, nibbler, victim);
  }
});

describe('歩き回りの観測', () => {
  it('座標と内部の通し番号を出さない', () => {
    const w = world();
    run(w, 3);
    const text = JSON.stringify(buildRoamObservation(w, w.roster[0]!));
    expect(text).not.toMatch(/"(x|y|pos|path|id)"/);
    for (const player of w.players) expect(text).not.toContain(`"${player.id}"`);
  });

  it('見えていない相手の状態や、他人の役職・口調を変えても、本人の観測は変わらない', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 100_000 }),
        fc.integer({ min: 0, max: 4 }),
        fc.integer({ min: 0, max: 120 }),
        fc.array(fc.tuple(fc.integer({ min: 0, max: 23 }), fc.integer({ min: 0, max: 13 })), { minLength: 4, maxLength: 4 }),
        fc.string(),
        fc.boolean(),
        fc.boolean(),
        (seed, seat, ticks, tiles, hidden, swapRole, putToSleep) => {
          const w = world(seed);
          // 全員を適当に歩かせてから調べる
          w.roster.forEach((id, i) => applyRoamIntent(w, id, { action: 'move_to', target: w.map.roomNames[(i + seed) % 4]! }));
          run(w, ticks);
          const observer = w.roster[seat]!;
          const before = buildRoamObservation(w, observer);
          const unseen = w.roster.filter((id) => id !== observer && !visibleTo(w, observer).includes(id));

          const changed = structuredClone(w);
          const me = changed.players.find((p) => p.id === observer)!;
          for (const player of changed.players) if (player.id !== observer) {
            player.persona = hidden;
            player.style = hidden;
          }
          for (const key of Object.keys(changed.napReadyAt)) if (key !== observer) changed.napReadyAt[key] = 999;
          changed.incidents.push({ t: 1, round: 1, byId: hidden, targetId: hidden, room: hidden, witnesses: [] });
          unseen.forEach((id, i) => {
            const actor = actorById(changed, id);
            actor.task = { kind: 'wait', until: 999 };
            actor.path = [];
            actor.lastResult = hidden;
            actor.events = [hidden];
            // 見えない所で餅になっていても、本人には分からない
            if (putToSleep && i === 0) playerById(changed, id).status = 'asleep';
            // 見えない場所どうしでなら、どこへ動かしても観測は変わらないはず
            const [x, y] = tiles[i]!;
            if (isWalkable(changed.map, x, y)) {
              const keep = actor.pos;
              actor.pos = centerOf({ x, y });
              if (visibleTo(changed, observer).includes(id)) actor.pos = keep;
            }
          });
          if (swapRole && me.role === 'artisan') {
            const others = changed.players.filter((p) => p.id !== observer);
            const from = others.find((p) => p.role === 'nibbler');
            const to = others.find((p) => p.role === 'artisan');
            if (from && to) {
              [from.role, to.role] = ['artisan', 'nibbler'];
              changed.truth.nibblerIds = [to.id];
              actorById(changed, from.id).nibbler = false;
              actorById(changed, to.id).nibbler = true;
            }
          }
          expect(buildRoamObservation(changed, observer)).toEqual(before);
        },
      ),
      { numRuns: 300 },
    );
  });
});

describe('近くの人にだけ聞こえる声', () => {
  it('声は、壁の無い近くの人にだけ届き、話した本人にも自分の声として入る。次の刻みで消える', () => {
    const { w, nibbler, victim, rest } = stage();
    expect(speakAloud(w, victim, '  倉庫の奥、だれかいる？  ')).toBe(true);
    const near = buildRoamObservation(w, nibbler);
    expect(near.heard).toEqual([{ speaker: name(w, victim), text: '倉庫の奥、だれかいる？', where: areaAt(map, actorById(w, victim).pos) }]);
    expect(buildRoamObservation(w, victim).heard).toEqual([{ speaker: name(w, victim), text: '倉庫の奥、だれかいる？', where: areaAt(map, actorById(w, victim).pos) }]);
    for (const id of rest) expect(buildRoamObservation(w, id).heard).toEqual([]);
    expect(w.happenings.at(-1)).toMatchObject({ type: 'chat', id: victim, text: '倉庫の奥、だれかいる？', heard: [nibbler] });
    stepRoam(w);
    expect(buildRoamObservation(w, nibbler).heard).toEqual([]);
  });

  it('話してから少しの間は、次の声を出せない。抜け道の中では話せず、聞こえもしない', () => {
    const { w, nibbler, victim } = stage(1, { chatGap: 6 });
    expect(speakAloud(w, victim, 'ひとつめ')).toBe(true);
    expect(speakAloud(w, victim, 'ふたつめ')).toBe(false);
    expect(buildRoamObservation(w, victim).chatWaitSeconds).toBe(6);
    run(w, Math.round(6 / w.roam.tickSeconds));
    expect(buildRoamObservation(w, victim).chatWaitSeconds).toBe(0);
    actorById(w, nibbler).under = true;
    expect(speakAloud(w, nibbler, '床下から')).toBe(false);
    expect(speakAloud(w, victim, 'みっつめ')).toBe(true);
    expect(w.happenings.at(-1)).toMatchObject({ type: 'chat', heard: [] });
    expect(speakAloud(w, victim, '   ')).toBe(false);
  });

  it('あかりが消えて姿が見えなくても、近くの声は聞こえる（誰の声かは分かるが、場所は分からない）', () => {
    const { w, rest } = stage();
    const [speaker, listener] = rest as [PlayerId, PlayerId];
    actorById(w, speaker).pos = centerOf({ x: 2, y: 11 });
    actorById(w, listener).pos = centerOf({ x: 5, y: 11 });
    expect(isWalkable(map, 5, 11)).toBe(true);
    w.trouble = { kind: 'lights' };
    expect(visibleTo(w, listener)).not.toContain(speaker);
    expect(speakAloud(w, speaker, 'まっくらだ！')).toBe(true);
    expect(buildRoamObservation(w, listener).heard).toEqual([{ speaker: name(w, speaker), text: 'まっくらだ！', where: null }]);
  });
});
