// 仕込み・鐘・妨害・抜け道・心だけの仕込み・妖精2人・妖精びいき・狐の決まり（広い工房のマップで確かめる）。勝ち負けを確かめる所は、狐を入れない（起きた狐が勝ちを横取りするので）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  actorById,
  actorMark,
  applyBallots,
  applyRoamIntent,
  applySpeak,
  areaAt,
  buildRoamObservation,
  centerOf,
  createRoamWorld,
  currentSpeaker,
  endMeeting,
  findRoute,
  nameOf,
  playerById,
  RuleViolation,
  stepRoam,
  UNDER_FLOOR,
  visibleTo,
} from '../src/index.ts';
import type { Ballot, MapDefinition, PlayerId, RoamWorld } from '../src/index.ts';

const mapDef = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../content/maps/workshop.json'), 'utf8')) as MapDefinition;

const run = (w: RoamWorld, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / w.roam.tickSeconds); i++) stepRoam(w);
};
const name = (w: RoamWorld, id: PlayerId) => nameOf(w, id);
const place = (w: RoamWorld, id: PlayerId, x: number, y: number) => {
  actorById(w, id).pos = centerOf({ x, y });
};
const violation = (action: () => void): RuleViolation => {
  try {
    action();
  } catch (error) {
    if (error instanceof RuleViolation) return error;
    throw error;
  }
  throw new Error('断られるはずの行動が通りました');
};

/**
 * 11人の試合を作り、全員を座敷の奥（ほかの部屋からは見えない）に並べる。
 * 待ち時間はどれも 0 にしておく（待ち時間そのものを確かめるテストは、自分で入れ直す）。
 */
function stage(seed = 1, roam: Partial<RoamWorld['roam']> = {}) {
  const w = createRoamWorld({ seed, map: mapDef, players: 11, roam });
  const nibblers = w.truth.nibblerIds as [PlayerId, PlayerId];
  const madmen = w.truth.madmanIds;
  const foxes = w.truth.foxIds;
  const artisans = w.roster.filter((id) => !nibblers.includes(id) && !madmen.includes(id) && !foxes.includes(id));
  w.roster.forEach((id, i) => place(w, id, 58 + i, 43));
  for (const id of nibblers) w.napReadyAt[id] = 0;
  w.sabotageReadyAt = 0;
  w.doorReadyAt = 0;
  w.bellReadyAt = 0;
  return { w, nibblers, madmen, foxes, artisans: artisans as [PlayerId, PlayerId, PlayerId, ...PlayerId[]] };
}

/**
 * その人に「出勤カードを切る」（帳場、1工程）を持たせる（2026-11-19 から、出勤カードは全員共通ではなく、ほかと同じ短い仕込みのひとつ）。
 * 従業員なら、工房全体の工程の数にも足す。
 */
function giveCard(w: RoamWorld, id: PlayerId): void {
  const actor = actorById(w, id);
  if (actor.duties.some((duty) => duty.name === '出勤カードを切る')) return;
  actor.duties.unshift({ name: '出勤カードを切る', steps: [{ station: 'card', what: '出勤カードを切る', room: '帳場', seconds: Math.max(1, Math.round(3 * w.roam.dutyPace)), done: false }] });
  if (!actor.nibbler && !actor.madman && !actor.fox) w.taskTotal += 1;
}

/** 集会を、決めた票で最後まで進める。 */
function hold(w: RoamWorld, votes: (voter: PlayerId) => Ballot = () => 'skip') {
  for (let speaker = currentSpeaker(w); speaker !== null; speaker = currentSpeaker(w)) applySpeak(w, speaker, '見たことを話すね。');
  applyBallots(w, Object.fromEntries(w.meeting.seats.map((id) => [id, votes(id)])));
  endMeeting(w);
}

describe('人数と役職', () => {
  it('9人以上では、妖精が2人になり、互いを知っている。従業員は誰の役職も知らない', () => {
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 8 }).truth.nibblerIds).toHaveLength(1);
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 9 }).truth.nibblerIds).toHaveLength(2);
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 8, roam: { nibblers: 2 } }).truth.nibblerIds).toHaveLength(2);
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 11, roam: { nibblers: 1 } }).truth.nibblerIds).toHaveLength(1);
    // 登場人物は12人。13人目はいない
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 11 }).roster).toHaveLength(11);
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 12 }).roster).toHaveLength(12);
    expect(() => createRoamWorld({ seed: 1, map: mapDef, players: 13 })).toThrow('3〜12');
    const { w, nibblers, artisans } = stage();
    expect(new Set(w.players.map((p) => p.name)).size).toBe(11);
    const [first, second] = nibblers;
    expect(buildRoamObservation(w, first).self.allies).toEqual([name(w, second)]);
    expect(buildRoamObservation(w, second).self.allies).toEqual([name(w, first)]);
    for (const id of artisans) {
      const obs = buildRoamObservation(w, id);
      expect(obs.self.allies).toEqual([]);
      expect(obs.sabotage).toBeNull();
      expect(obs.hatches).toBeNull();
      expect(obs.napCooldown).toBeNull();
    }
  });

  it('妖精どうしは餅に変え合えない。仲間に見られているのは「見られていない」うちに入る', () => {
    const { w, nibblers, artisans } = stage();
    const [first, second] = nibblers;
    const victim = artisans[0];
    place(w, first, 5, 30);
    place(w, second, 6, 30);
    place(w, victim, 5, 31);
    expect(violation(() => applyRoamIntent(w, first, { action: 'transform', target: name(w, second) })).code).toBe('ally');
    applyRoamIntent(w, first, { action: 'transform_if_unseen', target: name(w, victim) });
    run(w, 0.4);
    expect(playerById(w, victim).status).toBe('asleep');
  });
});

/** 妖精びいきの試合（2026-11-18 から既定では入れないので、指定して入れる。狐は入れない）。 */
const FAN = { madmen: 1, foxes: 0 } as const;

describe('妖精びいき', () => {
  it('指定した時だけ入る。誰も知らず、誰からも知られない。特別な行動は無く、従業員と同じものが見える', () => {
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 11 }).truth.madmanIds).toHaveLength(0);
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 11, roam: { madmen: 0 } }).truth.madmanIds).toHaveLength(0);
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 8, roam: { madmen: 1 } }).truth.madmanIds).toHaveLength(1);
    // 妖精びいきを入れても、妖精の顔ぶれは変わらない
    expect(createRoamWorld({ seed: 5, map: mapDef, players: 11, roam: FAN }).truth.nibblerIds).toEqual(createRoamWorld({ seed: 5, map: mapDef, players: 11 }).truth.nibblerIds);
    const { w, nibblers, madmen, artisans } = stage(1, FAN);
    expect(madmen).toHaveLength(1);
    const fan = madmen[0] as PlayerId;
    expect(nibblers).not.toContain(fan);
    expect(playerById(w, fan).role).toBe('madman');
    const fanObs = buildRoamObservation(w, fan);
    expect(fanObs.self.allies).toEqual([]);
    expect(fanObs.sabotage).toBeNull();
    expect(fanObs.hatches).toBeNull();
    expect(fanObs.napCooldown).toBeNull();
    for (const id of nibblers) expect(buildRoamObservation(w, id).self.allies).not.toContain(name(w, fan));
    // 顔ぶれの人数は全員が知っている（誰がどれかは入らない）
    for (const id of [fan, artisans[0], nibblers[0]]) expect(buildRoamObservation(w, id).cast).toEqual({ total: 11, nibblers: 2, madmen: 1, foxes: 0 });
    for (const action of ['transform', 'transform_if_unseen', 'sneak', 'sabotage']) {
      expect(violation(() => applyRoamIntent(w, fan, { action, target: name(w, artisans[0]) })).code).toBe('unknown_action');
    }
  });

  it('仕込みはふりだけで進み具合に数えない。妖精は妖精びいきも餅に変えられ、餅になっても心だけの仕込みは無い', () => {
    const { w, nibblers, madmen, artisans } = stage(1, FAN);
    const fan = madmen[0] as PlayerId;
    const steps = artisans.reduce((sum, id) => sum + actorById(w, id).duties.reduce((n, duty) => n + duty.steps.length, 0), 0);
    expect(w.taskTotal).toBe(steps);
    applyRoamIntent(w, fan, { action: 'do_task', target: 'なし' });
    run(w, 60);
    const pretended = w.happenings.filter((h) => h.type === 'task' && h.id === fan);
    expect(pretended.length).toBeGreaterThan(0);
    for (const h of pretended) expect(h).toMatchObject({ pretend: true });
    expect(w.taskDone).toBe(0);
    place(w, nibblers[0], 5, 30);
    place(w, fan, 5, 31);
    applyRoamIntent(w, nibblers[0], { action: 'transform', target: name(w, fan) });
    run(w, 0.4);
    expect(playerById(w, fan).status).toBe('asleep');
    expect(actorById(w, fan).spirit).toBeNull();
  });

  it('クビになった時に知らされるのは、妖精だったかどうかだけ（従業員と妖精びいきで同じ文になる）', () => {
    const historyAfterEjecting = (pickTarget: (s: ReturnType<typeof stage>) => PlayerId) => {
      const s = stage(1, FAN);
      const target = pickTarget(s);
      applyRoamIntent(s.w, s.artisans[0], { action: 'call_meeting', target: 'なし' });
      run(s.w, 120);
      expect(s.w.stage).toBe('meeting');
      hold(s.w, (voter) => (voter === target ? 'skip' : target));
      // 誰が誰に入れたか（席順）は、役職の文とは別に明かされるので、比べる時は外す
      return { line: (s.w.history[0] as string).replace(/（[^（）]*→[^（）]*）/, '').replaceAll(nameOf(s.w, target), '〇〇'), w: s.w };
    };
    const fan = historyAfterEjecting((s) => s.madmen[0] as PlayerId);
    const plain = historyAfterEjecting((s) => s.artisans[2]);
    const fairy = historyAfterEjecting((s) => s.nibblers[0]);
    expect(fan.line).toContain('〇〇 をクビにした（妖精ではなかった）');
    expect(fan.line).toBe(plain.line);
    expect(fairy.line).toContain('〇〇 をクビにした（妖精だった）');
    expect(fan.line).not.toMatch(/妖精びいき|従業員/);
  });

  it('頭数は人間の側に数える。起きている人間（従業員と妖精びいき）が妖精の人数以下で、妖精と妖精びいきの勝ち', () => {
    const { w, nibblers, madmen, artisans } = stage(1, FAN);
    // 起きているのを、妖精2人・妖精びいき1人・従業員2人にする
    for (const id of artisans.slice(2)) playerById(w, id).status = 'asleep';
    for (const id of artisans.slice(2)) actorById(w, id).onMap = false;
    place(w, nibblers[0], 5, 30);
    place(w, artisans[0], 5, 31);
    applyRoamIntent(w, nibblers[0], { action: 'transform', target: name(w, artisans[0]) });
    run(w, 0.4);
    // 人間は 従業員1・妖精びいき1 の2人 = 妖精2人
    expect(w.result).toEqual({ winner: 'nibbler', why: 'outnumbered' });
    expect(madmen.every((id) => playerById(w, id).status === 'awake')).toBe(true);
  });
});

describe('狐', () => {
  it('11人の試合で1人（10人までは入らない）。誰も知らず、誰からも知られない。特別な行動は無い', () => {
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 10 }).truth.foxIds).toHaveLength(0);
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 11, roam: { foxes: 0 } }).truth.foxIds).toHaveLength(0);
    // 狐を入れても、妖精の顔ぶれは変わらない
    expect(createRoamWorld({ seed: 5, map: mapDef, players: 11, roam: { foxes: 0 } }).truth.nibblerIds).toEqual(createRoamWorld({ seed: 5, map: mapDef, players: 11 }).truth.nibblerIds);
    const { w, nibblers, madmen, foxes, artisans } = stage();
    expect(madmen).toHaveLength(0);
    expect(foxes).toHaveLength(1);
    const fox = foxes[0] as PlayerId;
    expect(nibblers).not.toContain(fox);
    expect(playerById(w, fox).role).toBe('fox');
    const obs = buildRoamObservation(w, fox);
    expect(obs.self.allies).toEqual([]);
    expect(obs.sabotage).toBeNull();
    expect(obs.hatches).toBeNull();
    expect(obs.napCooldown).toBeNull();
    for (const id of nibblers) expect(buildRoamObservation(w, id).self.allies).not.toContain(name(w, fox));
    for (const id of [fox, artisans[0], nibblers[0]]) expect(buildRoamObservation(w, id).cast).toEqual({ total: 11, nibblers: 2, madmen: 0, foxes: 1 });
    for (const action of ['transform', 'transform_if_unseen', 'sneak', 'sabotage']) {
      expect(violation(() => applyRoamIntent(w, fox, { action, target: name(w, artisans[0]) })).code).toBe('unknown_action');
    }
  });

  it('仕込みはふりだけ。妖精は狐も餅に変えられる', () => {
    const { w, nibblers, foxes } = stage();
    const fox = foxes[0] as PlayerId;
    applyRoamIntent(w, fox, { action: 'do_task', target: 'なし' });
    run(w, 60);
    expect(w.happenings.filter((h) => h.type === 'task' && h.id === fox).every((h) => h.type === 'task' && h.pretend)).toBe(true);
    expect(w.taskDone).toBe(0);
    place(w, nibblers[0], 5, 30);
    place(w, fox, 5, 31);
    applyRoamIntent(w, nibblers[0], { action: 'transform', target: name(w, fox) });
    run(w, 0.4);
    expect(playerById(w, fox).status).toBe('asleep');
  });

  it('起きたまま試合が終われば、どちらが勝っても狐が横取りする。餅になっていれば横取りしない', () => {
    // 妖精が勝つはずの終わり方（起きている人間が妖精の人数以下）
    const fairyWin = (foxAsleep: boolean) => {
      const { w, nibblers, foxes, artisans } = stage();
      const fox = foxes[0] as PlayerId;
      for (const id of artisans.slice(1)) {
        playerById(w, id).status = 'asleep';
        actorById(w, id).onMap = false;
      }
      if (foxAsleep) {
        playerById(w, fox).status = 'asleep';
        actorById(w, fox).onMap = false;
      }
      place(w, nibblers[0], 5, 30);
      place(w, artisans[0], 5, 31);
      applyRoamIntent(w, nibblers[0], { action: 'transform', target: name(w, artisans[0]) });
      run(w, 0.4);
      return w.result;
    };
    expect(fairyWin(false)).toEqual({ winner: 'fox', why: 'outnumbered', stolenFrom: 'nibbler' });
    expect(fairyWin(true)).toEqual({ winner: 'nibbler', why: 'outnumbered' });
    // 従業員が勝つはずの終わり方（仕込みがぜんぶ終わる）
    const { w } = stage();
    w.taskDone = w.taskTotal;
    run(w, 1);
    expect(w.result).toEqual({ winner: 'fox', why: 'tasks_done', stolenFrom: 'artisan' });
  });

  it('クビになった狐は、全員には「妖精ではなかった」と出る', () => {
    const s = stage();
    const fox = s.foxes[0] as PlayerId;
    applyRoamIntent(s.w, s.artisans[0], { action: 'call_meeting', target: 'なし' });
    run(s.w, 120);
    expect(s.w.stage).toBe('meeting');
    hold(s.w, (voter) => (voter === fox ? 'skip' : fox));
    expect(s.w.history[0]).toContain(`${nameOf(s.w, fox)} をクビにした（妖精ではなかった）`);
    expect(s.w.history[0]).not.toMatch(/狐/);
  });
});

describe('仕込み', () => {
  it('全員が同じ形の仕込みを持ち、進み具合に数えるのは従業員の分だけ', () => {
    const { w, artisans } = stage();
    // 1人に14工程。ずんだ餅づくり・機械の修理・開店の支度を 5:3:2 で（7・4・3）。全員共通の仕込みは無い
    const groupOf = new Map((mapDef.duties ?? []).map((duty) => [duty.name, duty.group]));
    for (const actor of w.actors) {
      const steps: Record<string, number> = {};
      for (const duty of actor.duties) steps[groupOf.get(duty.name) ?? '?'] = (steps[groupOf.get(duty.name) ?? '?'] ?? 0) + duty.steps.length;
      expect(steps).toEqual({ mochi: 7, machine: 4, shop: 3 });
    }
    const steps = artisans.reduce((sum, id) => sum + actorById(w, id).duties.reduce((n, duty) => n + duty.steps.length, 0), 0);
    expect(w.taskTotal).toBe(steps);
    expect(buildRoamObservation(w, artisans[0]).taskBar).toEqual({ done: 0, total: steps });
  });

  it('持ち場へ歩いて手を動かすと、手順が終わり、進み具合が増える。続けて頼んでも、手は止まらない', () => {
    const { w, artisans } = stage();
    const [worker, watcher] = artisans;
    giveCard(w, worker);
    place(w, worker, 5, 38);
    place(w, watcher, 8, 38);
    applyRoamIntent(w, worker, { action: 'do_task', target: '出勤カードを切る' });
    run(w, 2);
    // 帳場の出勤カードの前で、手を動かしている。そばの人には、それが見える
    expect(buildRoamObservation(w, worker).activity).toBe('帳場 で「出勤カードを切る」をしている');
    expect(actorMark(w, actorById(w, worker))).toBe('w');
    expect(buildRoamObservation(w, watcher).visible.find((v) => v.name === name(w, worker))).toMatchObject({ working: true, asleep: false });
    expect(w.taskDone).toBe(0);
    // 途中でもう一度頼んでも、最初からにはならない（手を動かす時間は 3秒 × 倍率）
    run(w, 4);
    applyRoamIntent(w, worker, { action: 'do_task', target: 'なし' });
    run(w, 3 * w.roam.dutyPace - 4);
    expect(w.taskDone).toBe(1);
    expect(buildRoamObservation(w, worker).duties?.find((duty) => duty.name === '出勤カードを切る')?.steps[0]).toMatchObject({ done: true });
    expect(w.happenings.at(-1)).toMatchObject({ type: 'task', id: worker, what: '出勤カードを切る', pretend: false, spirit: false, done: 1 });
    // 終わったら、止められるまで次の仕込みへ進む
    // （次の持ち場が同じ部屋なら、もう手を動かしている）
    run(w, 0.4);
    expect(buildRoamObservation(w, worker).idle).toBe(false);
    expect(buildRoamObservation(w, worker).activity).toMatch(/(へ向かっている|をしている)$/);
    expect(buildRoamObservation(w, worker).activity).not.toContain('出勤カード');
    // もう終わった仕込みの名前を言われても、残りを近い持ち場から進める
    applyRoamIntent(w, worker, { action: 'do_task', target: '出勤カードを切る' });
    run(w, 0.4);
    expect(buildRoamObservation(w, worker).activity).toMatch(/(へ向かっている|をしている)$/);
    expect(buildRoamObservation(w, worker).activity).not.toContain('出勤カード');
  });

  it('妖精の仕込みは、ふりだけ。そばからは同じに見えるが、進み具合は増えない', () => {
    const { w, nibblers, artisans } = stage();
    const faker = nibblers[0];
    const watcher = artisans[0];
    giveCard(w, faker);
    place(w, faker, 5, 38);
    place(w, watcher, 8, 38);
    applyRoamIntent(w, faker, { action: 'do_task', target: '出勤カードを切る' });
    run(w, 2);
    expect(buildRoamObservation(w, faker).activity).toBe('帳場 で「出勤カードを切る」のふりをしている');
    expect(buildRoamObservation(w, watcher).visible.find((v) => v.name === name(w, faker))).toMatchObject({ working: true });
    run(w, 3 * w.roam.dutyPace);
    expect(w.taskDone).toBe(0);
    expect(w.happenings.find((h) => h.type === 'task')).toMatchObject({ id: faker, pretend: true });
    expect(buildRoamObservation(w, watcher).taskBar?.done).toBe(0);
  });

  it('従業員の仕込みがぜんぶ終われば、従業員の勝ち', () => {
    const { w, artisans } = stage(1, { foxes: 0 });
    const last = artisans[0];
    giveCard(w, last);
    for (const id of artisans) {
      for (const duty of actorById(w, id).duties) for (const step of duty.steps) step.done = !(id === last && duty.name === '出勤カードを切る');
    }
    w.taskDone = w.taskTotal - 1;
    place(w, last, 3, 38);
    applyRoamIntent(w, last, { action: 'do_task', target: 'なし' });
    run(w, 3 * w.roam.dutyPace + 2);
    expect(w).toMatchObject({ stage: 'over', result: { winner: 'artisan', why: 'tasks_done' } });
  });

  it('開店の時刻までに仕込みが終わらなければ、妖精の勝ち', () => {
    const { w } = stage(1, { roamSeconds: 3, foxes: 0 });
    run(w, 3);
    expect(w).toMatchObject({ stage: 'over', clock: 3, result: { winner: 'nibbler', why: 'late' } });
  });

  it('ずんだ餅になった従業員は、心だけで仕込みを続ける。集会で運ばれたあとも続く。クビになった従業員の残りは数えない', () => {
    const { w, nibblers, artisans } = stage();
    const [victim, finder, unlucky] = artisans;
    place(w, nibblers[0], 5, 30);
    place(w, victim, 5, 31);
    applyRoamIntent(w, nibblers[0], { action: 'transform', target: name(w, victim) });
    run(w, 0.4);
    expect(playerById(w, victim).status).toBe('asleep');
    expect(actorById(w, victim).spirit).not.toBeNull();
    run(w, 60);
    const dreamt = w.taskDone;
    expect(dreamt).toBeGreaterThan(0);
    expect(w.happenings.filter((h) => h.type === 'task').every((h) => h.type === 'task' && h.id === victim && h.spirit)).toBe(true);
    // 体（餅）は変わった場所から動かない
    expect(areaAt(w.map, actorById(w, victim).pos)).toBe('氷室');

    place(w, finder, 6, 31);
    applyRoamIntent(w, finder, { action: 'report', target: name(w, victim) });
    const total = w.taskTotal;
    const left = actorById(w, unlucky).duties.reduce((n, duty) => n + duty.steps.filter((step) => !step.done).length, 0);
    hold(w, (voter) => (voter === unlucky ? 'skip' : unlucky));
    expect(playerById(w, unlucky).status).toBe('sent_home');
    expect(w.taskTotal).toBe(total - left);
    expect(actorById(w, victim).onMap).toBe(false);
    run(w, 60);
    expect(w.taskDone).toBeGreaterThan(dreamt);
  });
});

describe('中庭の鐘', () => {
  it('鐘の前まで歩いて鳴らすと、集会が開く。1人1回', () => {
    const { w, artisans } = stage();
    const ringer = artisans[0];
    place(w, ringer, 37, 26);
    expect(buildRoamObservation(w, ringer).bell).toEqual({ usesLeft: 1, waitSeconds: 0 });
    applyRoamIntent(w, ringer, { action: 'call_meeting', target: 'なし' });
    expect(buildRoamObservation(w, ringer).activity).toBe('中庭の鐘を鳴らしに向かっている');
    run(w, 3);
    expect(w.stage).toBe('meeting');
    expect(w.found).toBeNull();
    expect(w.meeting.reason).toBe(`${name(w, ringer)} が中庭の鐘を鳴らして、みんなを集めた`);
    expect(w.meeting.reporterId).toBe(ringer);
    expect(w.happenings.at(-1)).toMatchObject({ type: 'bell', id: ringer });
    hold(w);
    expect(w.history.at(-1)).toContain('中庭の鐘を鳴らして');
    // 見回りの初めは、しばらく鳴らせない。もう鳴らした人は、ずっと鳴らせない
    expect(buildRoamObservation(w, ringer).bell).toEqual({ usesLeft: 0, waitSeconds: w.roam.bellCooldown });
    expect(violation(() => applyRoamIntent(w, ringer, { action: 'call_meeting', target: 'なし' })).message).toBe('自分はもう鐘を鳴らせない');
    expect(violation(() => applyRoamIntent(w, artisans[1], { action: 'call_meeting', target: 'なし' })).message).toBe(`鐘は、あと${w.roam.bellCooldown}秒鳴らせない`);
  });

  it('困りごとが続いている間は、鳴らせない', () => {
    const { w, nibblers, artisans } = stage();
    applyRoamIntent(w, nibblers[0], { action: 'sabotage', target: 'あかり' });
    expect(violation(() => applyRoamIntent(w, artisans[0], { action: 'call_meeting', target: 'なし' })).message).toBe('困りごとが片づくまで、鐘は鳴らせない');
  });
});

describe('妨害', () => {
  it('従業員は妨害も抜け道も使えず、知らない行動と同じ断られ方をする', () => {
    const { w, artisans } = stage();
    for (const [action, target] of [['sabotage', 'あかり'], ['sabotage', '氷室'], ['sneak', '氷室'], ['transform', name(w, artisans[1])]] as const) {
      const error = violation(() => applyRoamIntent(w, artisans[0], { action, target }));
      expect([error.code, error.message]).toEqual(['unknown_action', 'その行動はできません']);
    }
    expect(w.trouble).toBeNull();
    expect(w.shut).toEqual([]);
  });

  it('あかりを消すと、従業員は近くしか見えなくなる。ブレーカーで直せる。次の妨害までは間がある', () => {
    const { w, nibblers, artisans } = stage();
    const [a, b] = artisans;
    const nibbler = nibblers[0];
    place(w, a, 20, 11);
    place(w, b, 24, 11);
    place(w, nibbler, 27, 11);
    expect(visibleTo(w, a)).toContain(b);
    applyRoamIntent(w, nibbler, { action: 'sabotage', target: 'あかり' });
    expect(buildRoamObservation(w, nibbler).lastResult).toBe('工房のあかりを消した');
    expect(buildRoamObservation(w, a).events).toEqual(['工房のあかりが消えた。道具部屋 の「ブレーカー」で直せる']);
    expect(buildRoamObservation(w, a).trouble).toEqual({ kind: 'lights', secondsLeft: null, fixAt: [{ name: 'ブレーカー', room: '道具部屋', held: false }] });
    // 4升離れた従業員どうしは見えない。妖精からは、7升先も見える
    expect(visibleTo(w, a)).not.toContain(b);
    expect(visibleTo(w, b)).not.toContain(nibbler);
    expect(visibleTo(w, nibbler)).toEqual(expect.arrayContaining([a, b]));
    expect(violation(() => applyRoamIntent(w, nibblers[1], { action: 'sabotage', target: 'かまど' })).code).toBe('trouble_active');

    place(w, a, 67, 28);
    applyRoamIntent(w, a, { action: 'fix', target: 'なし' });
    run(w, 1);
    expect(buildRoamObservation(w, a).activity).toBe('道具部屋 の「ブレーカー」で、あかりを直している');
    run(w, w.roam.fixSeconds);
    expect(w.trouble).toBeNull();
    expect(buildRoamObservation(w, a).lastResult).toBe('あかりを直した');
    expect(w.happenings.at(-1)).toMatchObject({ type: 'fixed', what: 'lights', ids: [a] });
    place(w, a, 20, 11);
    expect(visibleTo(w, a)).toContain(b);
    const wait = buildRoamObservation(w, nibbler).sabotage?.waitSeconds ?? 0;
    expect(wait).toBeGreaterThan(w.roam.sabotageCooldown - 2);
    expect(violation(() => applyRoamIntent(w, nibbler, { action: 'sabotage', target: 'あかり' })).code).toBe('cooldown');
    expect(violation(() => applyRoamIntent(w, a, { action: 'fix', target: 'なし' })).code).toBe('no_trouble');
  });

  it('かまどの焚きすぎは、2か所に同時に人がつくと落ち着く。1か所だけでは直らない', () => {
    const { w, nibblers, artisans } = stage();
    const [a, b] = artisans;
    applyRoamIntent(w, nibblers[0], { action: 'sabotage', target: 'かまど' });
    expect(buildRoamObservation(w, a).events[0]).toContain('かまどが焚かれすぎている！ 45秒のうちに、蒸し場 の「かまどの火」と中庭 の「井戸の水」に、同時に人がつかないといけない');
    place(w, a, 48, 6);
    applyRoamIntent(w, a, { action: 'fix', target: 'かまどの火' });
    run(w, 10);
    expect(buildRoamObservation(w, a).activity).toBe('蒸し場 の「かまどの火」についている（ほかの場所にも人がつくのを待っている）');
    expect(buildRoamObservation(w, b).trouble).toMatchObject({
      kind: 'crisis',
      secondsLeft: 35,
      fixAt: [{ name: 'かまどの火', room: '蒸し場', held: true }, { name: '井戸の水', room: '中庭', held: false }],
    });
    // 場所を言わなければ、まだ誰もついていない方へ向かう
    place(w, b, 44, 6);
    applyRoamIntent(w, b, { action: 'fix', target: 'なし' });
    expect(buildRoamObservation(w, b).activity).toBe('中庭 の「井戸の水」へ、直しに向かっている');
    place(w, b, 35, 27);
    run(w, 2);
    expect(w.trouble).toBeNull();
    expect(w.stage).toBe('roam');
    const fixed = w.happenings.at(-1);
    expect(fixed).toMatchObject({ type: 'fixed', what: 'crisis' });
    expect(fixed?.type === 'fixed' && [...fixed.ids].sort()).toEqual([a, b].sort());
    expect(buildRoamObservation(w, b).lastResult).toBe('かまどを落ち着かせた');
  });

  it('場所を言わずに直しに来た2人が同じ所へ向かっても、先に人がついたら、もう1人は空いている所へ回る', () => {
    const { w, nibblers, artisans } = stage();
    const [a, b, c] = artisans;
    applyRoamIntent(w, nibblers[0], { action: 'sabotage', target: 'かまど' });
    place(w, a, 48, 7);
    place(w, b, 46, 8);
    applyRoamIntent(w, a, { action: 'fix', target: 'なし' });
    applyRoamIntent(w, b, { action: 'fix', target: 'なし' });
    expect(buildRoamObservation(w, a).activity).toBe('蒸し場 の「かまどの火」へ、直しに向かっている');
    expect(buildRoamObservation(w, b).activity).toBe('蒸し場 の「かまどの火」へ、直しに向かっている');
    run(w, 2);
    expect(buildRoamObservation(w, a).activity).toContain('「かまどの火」についている');
    expect(buildRoamObservation(w, b).activity).toBe('中庭 の「井戸の水」へ、直しに向かっている');
    // 場所を名指しした人は、人がついていても、そこへ行く
    place(w, c, 46, 8);
    applyRoamIntent(w, c, { action: 'fix', target: 'かまどの火' });
    run(w, 2);
    expect(buildRoamObservation(w, c).activity).toContain('「かまどの火」');
    run(w, 25);
    expect(w.trouble).toBeNull();
    const fixed = w.happenings.at(-1);
    expect(fixed?.type === 'fixed' && [...fixed.ids].sort()).toEqual([a, b].sort());
  });

  it('かまどの焚きすぎを時間内に直せなければ、妖精の勝ち。集会が開けば、困りごとは片づく', () => {
    const lost = stage(1, { foxes: 0 });
    applyRoamIntent(lost.w, lost.nibblers[0], { action: 'sabotage', target: 'かまど' });
    place(lost.w, lost.artisans[0], 48, 6);
    applyRoamIntent(lost.w, lost.artisans[0], { action: 'fix', target: 'かまどの火' });
    run(lost.w, 44.8);
    expect(lost.w.stage).toBe('roam');
    run(lost.w, 0.2);
    expect(lost.w).toMatchObject({ stage: 'over', result: { winner: 'nibbler', why: 'crisis' } });

    const saved = stage();
    const [victim, finder] = saved.artisans;
    place(saved.w, saved.nibblers[0], 5, 30);
    place(saved.w, victim, 5, 31);
    place(saved.w, finder, 9, 31);
    applyRoamIntent(saved.w, saved.nibblers[0], { action: 'sabotage', target: 'かまど' });
    applyRoamIntent(saved.w, saved.nibblers[0], { action: 'transform', target: name(saved.w, victim) });
    run(saved.w, 0.4);
    applyRoamIntent(saved.w, finder, { action: 'report', target: name(saved.w, victim) });
    expect(saved.w.trouble).toBeNull();
    hold(saved.w);
    run(saved.w, 50);
    expect(saved.w.stage).toBe('roam');
  });

  it('戸を閉めると、その部屋は出入りも見通しもできなくなり、しばらくすると開く', () => {
    const { w, nibblers, artisans } = stage();
    const [inside, outside, far, inDoorway] = artisans as [PlayerId, PlayerId, PlayerId, PlayerId];
    place(w, inside, 11, 29);
    place(w, outside, 15, 29);
    place(w, far, 37, 26);
    place(w, inDoorway, 13, 30);
    expect(visibleTo(w, inside)).toContain(outside);
    applyRoamIntent(w, outside, { action: 'move_to', target: '氷室' });

    applyRoamIntent(w, nibblers[0], { action: 'sabotage', target: '氷室' });
    expect(buildRoamObservation(w, nibblers[0]).lastResult).toBe(`氷室 の戸を閉めた（${w.roam.doorSeconds}秒で開く）`);
    expect(violation(() => applyRoamIntent(w, nibblers[1], { action: 'sabotage', target: '氷室' })).code).toBe('already_shut');
    expect(violation(() => applyRoamIntent(w, nibblers[1], { action: 'sabotage', target: '倉庫' })).code).toBe('cooldown');
    expect(violation(() => applyRoamIntent(w, nibblers[1], { action: 'sabotage', target: '中庭' })).code).toBe('unknown_sabotage');
    // 戸口に立っていた人は、となりへよけている
    expect(w.map.closed).toHaveLength(2);
    expect(w.map.closed).not.toContain(Math.floor(actorById(w, inDoorway).pos.y) * w.map.width + Math.floor(actorById(w, inDoorway).pos.x));
    // 中からも外からも、気づく。離れた人は気づかない
    expect(buildRoamObservation(w, inside).events).toEqual(['氷室 の戸が閉まった']);
    expect(buildRoamObservation(w, outside).events).toEqual(['氷室 の戸が閉まった']);
    expect(buildRoamObservation(w, inside).shutRooms).toEqual(['氷室']);
    expect(buildRoamObservation(w, outside).shutRooms).toEqual(['氷室']);
    expect(buildRoamObservation(w, far).events).toEqual([]);
    expect(buildRoamObservation(w, far).shutRooms).toEqual([]);

    expect(visibleTo(w, inside)).not.toContain(outside);
    expect(findRoute(w.map, actorById(w, inside).pos, centerOf({ x: 15, y: 29 }))).toBeNull();
    expect(violation(() => applyRoamIntent(w, inside, { action: 'move_to', target: '西の廊下' })).code).toBe('no_path');
    run(w, 0.2);
    expect(buildRoamObservation(w, outside).lastResult).toBe('戸が閉まっていて、氷室 へ行けない');

    run(w, w.roam.doorSeconds);
    expect(w.shut).toEqual([]);
    expect(w.map.closed).toEqual([]);
    expect(w.happenings.at(-1)).toMatchObject({ type: 'door_open', room: '氷室' });
    expect(visibleTo(w, inside)).toContain(outside);
    applyRoamIntent(w, inside, { action: 'move_to', target: '西の廊下' });
  });
});

describe('床下の抜け道', () => {
  it('妖精は出入口から入り、同じ組の部屋に出る。中にいる間は、誰からも見えない。出入りを見た人には伝わる', () => {
    const { w, nibblers, artisans } = stage();
    const sneaker = nibblers[0];
    const [sawIn, sawOut] = artisans;
    place(w, sneaker, 10, 22);
    place(w, sawIn, 8, 20);
    place(w, sawOut, 8, 30);
    expect(buildRoamObservation(w, sneaker).hatches).toContainEqual({ group: '西', rooms: ['倉庫', '氷室', '帳場'] });
    expect(violation(() => applyRoamIntent(w, sneaker, { action: 'sneak', target: '中庭' })).code).toBe('no_hatch');
    applyRoamIntent(w, sneaker, { action: 'sneak', target: '氷室' });
    expect(buildRoamObservation(w, sneaker).activity).toBe('倉庫 の抜け道の出入口へ向かっている');
    run(w, 1);
    expect(actorById(w, sneaker).under).toBe(true);
    expect(actorMark(w, actorById(w, sneaker))).toBe('u');
    expect(visibleTo(w, sawIn)).not.toContain(sneaker);
    const under = buildRoamObservation(w, sneaker);
    expect(under).toMatchObject({ where: UNDER_FLOOR, visible: [], activity: '床下の抜け道を、氷室 へ進んでいる' });
    expect(violation(() => applyRoamIntent(w, sneaker, { action: 'move_to', target: '倉庫' })).code).toBe('under');
    expect(w.happenings.at(-1)).toMatchObject({ type: 'sneak', id: sneaker, phase: 'in', room: '倉庫', witnesses: [sawIn] });

    run(w, w.roam.sneakSeconds);
    expect(actorById(w, sneaker).under).toBe(false);
    expect(areaAt(w.map, actorById(w, sneaker).pos)).toBe('氷室');
    expect(buildRoamObservation(w, sneaker).lastResult).toBe('抜け道を通って、氷室 に出た');
    expect(w.happenings.at(-1)).toMatchObject({ type: 'sneak', id: sneaker, phase: 'out', room: '氷室', witnesses: [sawOut] });
    expect(visibleTo(w, sawOut)).toContain(sneaker);
  });

  it('見ていた人の観測には、その瞬間の出来事として入る', () => {
    const { w, nibblers, artisans } = stage();
    const sneaker = nibblers[0];
    place(w, sneaker, 11, 22);
    place(w, artisans[0], 8, 20);
    applyRoamIntent(w, sneaker, { action: 'sneak', target: '帳場' });
    let seen: string[] = [];
    for (let i = 0; i < 10 && seen.length === 0; i++) {
      stepRoam(w);
      seen = buildRoamObservation(w, artisans[0]).events;
    }
    expect(seen).toEqual([`${name(w, sneaker)} が 倉庫 の床下の抜け道に入っていくのを見た`]);
  });
});

describe('非干渉（広い工房）', () => {
  it('従業員の観測は、見えない相手の役職・待ち時間・鐘の残り・仕込みの中身を変えても同じ', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10_000 }),
        fc.integer({ min: 0, max: 10 }),
        fc.integer({ min: 0, max: 150 }),
        fc.integer({ min: 0, max: 99 }),
        (seed, seat, ticks, salt) => {
          const w = createRoamWorld({ seed, map: mapDef, players: 11 });
          // 少し動かしておく（仕込みへ向かう人、歩き回る人）
          w.roster.forEach((id, i) => {
            if (i % 2 === 0) applyRoamIntent(w, id, { action: 'do_task', target: 'なし' });
            else applyRoamIntent(w, id, { action: 'move_to', target: w.map.roomNames[(i + salt) % w.map.roomNames.length] as string });
          });
          for (let i = 0; i < ticks; i++) stepRoam(w);
          const observer = w.roster[seat] as PlayerId;
          if (actorById(w, observer).nibbler) return;
          const before = buildRoamObservation(w, observer);

          const changed = structuredClone(w);
          const hidden = changed.roster.filter((id) => id !== observer && !visibleTo(changed, observer).includes(id));
          changed.sabotageReadyAt += salt;
          changed.doorReadyAt += salt;
          for (const id of Object.keys(changed.napReadyAt)) changed.napReadyAt[id] = salt;
          for (const id of hidden) {
            const actor = actorById(changed, id);
            actor.bellUsesLeft = 0;
            actor.lastResult = `見えない結果${salt}`;
            actor.events = [`見えない出来事${salt}`];
            // 手を付けていない仕込みを、別の人のものと入れ替える（進み具合の数は変えない）
            actor.duties = actor.duties.map((duty) => (duty.steps.some((step) => step.done) ? duty : { ...duty, name: `${duty.name}${salt}` }));
          }
          // 見えない2人のあいだで、役職を入れ替える（妖精と従業員、妖精びいきと従業員。顔ぶれの人数は変えない）
          const artisansHidden = hidden.filter((id) => playerById(changed, id).role === 'artisan');
          const from = hidden.find((id) => actorById(changed, id).nibbler);
          const to = artisansHidden[0];
          if (from && to) {
            playerById(changed, from).role = 'artisan';
            playerById(changed, to).role = 'nibbler';
            actorById(changed, from).nibbler = false;
            actorById(changed, to).nibbler = true;
            changed.truth.nibblerIds = changed.truth.nibblerIds.map((id) => (id === from ? to : id));
          }
          const fan = hidden.find((id) => actorById(changed, id).madman);
          const plain = artisansHidden.find((id) => id !== to && id !== from);
          if (fan && plain) {
            playerById(changed, fan).role = 'artisan';
            playerById(changed, plain).role = 'madman';
            actorById(changed, fan).madman = false;
            actorById(changed, plain).madman = true;
            changed.truth.madmanIds = changed.truth.madmanIds.map((id) => (id === fan ? plain : id));
          }
          expect(buildRoamObservation(changed, observer)).toEqual(before);
        },
      ),
      { numRuns: 150 },
    );
  });

  it('観測に、座標や内部の番号、持ち場や出入口の内部の名前は入らない', () => {
    const { w, nibblers, artisans } = stage();
    applyRoamIntent(w, nibblers[0], { action: 'sabotage', target: 'かまど' });
    for (const id of [nibblers[0], artisans[0]]) {
      const text = JSON.stringify(buildRoamObservation(w, id));
      expect(text).not.toMatch(/"x":|"y":|"pos"|"id"|h-souko|wellwater|"p\d+"/);
    }
  });
});
