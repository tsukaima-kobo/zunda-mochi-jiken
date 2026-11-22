// 広い工房・11人の試合の決まり（仕込み、困りごと、戸、床下の抜け道、心だけの人、鐘、妖精マニア）が、
// 記録だけから、時刻の関数として上映の時間軸に乗ること。

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../server/src/index.ts';
import type { MatchLog } from '../../server/src/index.ts';
import { isWalkable, parseMap } from '../../sim/src/index.ts';
import { ANCHOR_X, ANCHOR_Y, Director, HOLD_SECONDS } from '../src/director.ts';
import type { Sites } from '../src/director.ts';
import { buildShow, doorRectsOf, ghostsAt, isUp, posesAt, progressAt, roamClockAt, showTimeOf, shutRoomsAt, troubleAt } from '../src/show.ts';
import type { Cue, RoamSegment, Show } from '../src/show.ts';
import { colorOf, ejectTruth, ejectVerdict, H, plainThought, ROLE_COLOR, ROLE_LABEL, ROLE_SHORT, SIDE_OF, W } from '../src/theme.ts';

const load = (name: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../content/maps/${name}.json`), 'utf8'));
const big = load('workshop');
/** 前の題材のころの、実物の頭脳の記録（この機体にあれば確かめる）。 */
const OLD_REAL = path.resolve(import.meta.dirname, '../../../matches/m43-20261116T233146/match.json');
const small = load('workshop-small');

const logs = new Map<string, Promise<MatchLog>>();
/** 台本ボットだけの、11人の試合（同じ種は1回だけ回す）。fan なら、狐の代わりに妖精マニアを入れる。 */
function play(seed: number, fan = false): Promise<MatchLog> {
  const key = `${seed}:${fan}`;
  let log = logs.get(key);
  if (!log) {
    // カメラの係の試験は、前の試合の中身（狐の横取りに条件の無い決まり）で確かめる。条件を足すと台本ボットの狐の動きが変わり、試合の中身が変わるため（2026-11-21）
    log = runMatch({ seed, map: big, players: 11, brains: [null], denyList: [], roam: fan ? { madmen: 1, foxes: 0 } : { foxSteps: 0 } });
    logs.set(key, log);
  }
  return log;
}

const roamsOf = (show: Show) => show.segments.filter((s): s is RoamSegment => s.kind === 'roam');
const cuesOf = <T extends MatchLog['events'][number]['type']>(show: Show, type: T) =>
  show.cues.filter((cue): cue is Cue & { event: Extract<MatchLog['events'][number], { type: T }> } => cue.event.type === type);
/** 上映の時刻が、どの見回りの中か。 */
const roamAt = (show: Show, time: number) => roamsOf(show).find((roam) => time >= roam.start - 1e-6 && time <= roam.end + 1e-6);

// 登場人物の名前が変わると、台本ボットの動きも変わる（名前を含む発言に反応するため）。そのたびに選び直す
// 25: 妨害・戸（閉まった部屋をカメラが映す）・抜け道 / 34: 中庭の鐘と、開店に間に合わない / 12: 仕込みが終わる / 54: 中庭の鐘
// 公開版の登場人物（色の名前の餅）で選んだ種。台本ボットは名前を乱数に使うので、登場人物が変わると試合も変わる。
// 68: 仕込みが終わって勝つ・鐘・戸・抜け道・かまど / 25・51: あかり・かまど・戸・抜け道。3つで、妨害3種・直す・戸が開く・抜け道・鐘がそろう（台本ボットで鐘が鳴る種は少ない）
const SEEDS = [68, 25, 51];

describe('見回りの新しいできごとの時間軸', () => {
  it('仕込み・妨害・直した・戸・抜け道・鐘は、起きた時刻に並ぶ', async () => {
    const seen = new Set<string>();
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      for (const type of ['task', 'sabotage', 'fixed', 'door_open', 'sneak', 'bell'] as const) {
        const cues = cuesOf(show, type);
        expect(cues.length, `${seed} ${type}`).toBe(log.events.filter((event) => event.type === type).length);
        for (const cue of cues) {
          seen.add(cue.event.type === 'sabotage' ? `sabotage:${cue.event.what}` : type);
          const roam = roamAt(show, cue.at);
          expect(roam, `${seed} ${type} ${cue.at}`).toBeDefined();
          // 声が詰まっている所では絵をゆっくり流すので、試合の時計から上映の時刻へ直して比べる
          expect(cue.at).toBeCloseTo(showTimeOf(roam!, cue.event.t), 6);
          expect(cue.end).toBeGreaterThan(cue.at);
        }
      }
    }
    for (const kind of ['task', 'sabotage:lights', 'sabotage:crisis', 'sabotage:door', 'fixed', 'door_open', 'sneak', 'bell']) expect([...seen]).toContain(kind);
  });

  it('仕込みの進み具合は、記録のとおりに進み、戻らない', async () => {
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      expect(progressAt(show, 0)).toEqual({ done: 0, total: log.roam!.taskTotal, ratio: 0, since: -Infinity });
      const real = cuesOf(show, 'task').filter((cue) => !cue.event.pretend);
      expect(real.length).toBeGreaterThan(20);
      for (const [index, cue] of real.entries()) {
        // 同じ瞬間に2つ終わった時は、あとのほうが残る
        if (real[index + 1]?.at === cue.at) continue;
        const after = progressAt(show, cue.at + 1e-4)!;
        expect(after).toMatchObject({ done: cue.event.done, total: cue.event.total, since: cue.at });
        expect(progressAt(show, cue.at - 1e-4)!.done).toBeLessThan(cue.event.done);
      }
      // ふりは数えない（同じ瞬間に、ほかの人の本物の仕込みが終わった時は別）
      const fakes = cuesOf(show, 'task').filter((cue) => cue.event.pretend && !real.some((other) => other.at === cue.at));
      expect(fakes.length).toBeGreaterThan(0);
      for (const cue of fakes) expect(progressAt(show, cue.at + 1e-4)!.since).toBeLessThan(cue.at);
      let done = 0;
      for (let time = 0; time <= show.total; time += 1.7) {
        const now = progressAt(show, time)!;
        expect(now.done).toBeGreaterThanOrEqual(done);
        expect(now.ratio).toBeLessThanOrEqual(1);
        done = now.done;
      }
      const last = progressAt(show, show.total)!;
      expect(last.done === last.total).toBe(log.result!.why === 'tasks_done');
    }
    expect((await play(SEEDS[0]!)).result!.why).toBe('tasks_done');
  });

  it('困りごとは、直すか、集会が始まるまで続く。かまどは残りの秒が減っていく', async () => {
    const hows = new Set<string>();
    const whats = new Set<string>();
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      const started = cuesOf(show, 'sabotage').filter((cue) => cue.event.what !== 'door');
      expect(show.troubles.map((span) => span.start)).toEqual(started.map((cue) => cue.at));
      show.troubles.reduce((end, span) => {
        expect(span.start).toBeGreaterThanOrEqual(end);
        expect(span.end).toBeGreaterThan(span.start);
        return span.end;
      }, 0);
      for (const [index, span] of show.troubles.entries()) {
        hows.add(span.how);
        whats.add(span.what);
        expect(span).toMatchObject({ what: started[index]!.event.what, by: started[index]!.event.by });
        expect(span.seconds).toBe(span.what === 'crisis' ? log.roam!.config.crisisSeconds : null);
        const middle = (span.start + span.end) / 2;
        const now = troubleAt(show, middle)!;
        expect(now.what).toBe(span.what);
        expect(now.age).toBeCloseTo(middle - span.start, 6);
        expect(now.left).toBe(span.seconds === null ? null : Math.max(0, span.seconds - now.age));
        expect(troubleAt(show, span.start - 1e-4)?.start).not.toBe(span.start);
        expect(troubleAt(show, span.end + 1e-4)?.start).not.toBe(span.start);
        if (span.how === 'fixed') {
          const fixed = cuesOf(show, 'fixed').find((cue) => Math.abs(cue.at - span.end) < 1e-6)!;
          expect(fixed.event).toMatchObject({ what: span.what, by: span.fixedBy });
        } else if (span.how === 'meeting') {
          expect(show.segments.some((s) => s.kind === 'meeting' && Math.abs(s.start - span.end) < 1e-6)).toBe(true);
          expect(span.fixedBy).toEqual([]);
        }
        // 集会のあいだは、何も起きていない
        for (const s of show.segments) if (s.kind === 'meeting') expect(troubleAt(show, (s.start + s.end) / 2)).toBeNull();
      }
    }
    expect([...whats].sort()).toEqual(['crisis', 'lights']);
    expect([...hows]).toContain('fixed');
  });

  it('戸は、決まった秒数だけ閉まる。戸口は、試合の決まりと同じ升目', async () => {
    const parsed = parseMap(big);
    const rects = doorRectsOf(big);
    expect(Object.keys(rects).sort()).toEqual(Object.keys(parsed.doorTiles).sort());
    for (const [room, doors] of Object.entries(rects)) {
      const tiles = new Set<number>();
      for (const door of doors) {
        for (let y = door.y; y < door.y + door.h; y++) for (let x = door.x; x < door.x + door.w; x++) if (isWalkable(parsed, x, y)) tiles.add(y * parsed.width + x);
      }
      expect([...tiles].sort((a, b) => a - b), room).toEqual([...new Set(parsed.doorTiles[room])].sort((a, b) => a - b));
    }
    expect(doorRectsOf(small)).toEqual({});

    let shut = 0;
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      const doors = cuesOf(show, 'sabotage').filter((cue) => cue.event.what === 'door');
      expect(show.shuts.length).toBe(doors.length);
      for (const cue of doors) {
        shut++;
        const span = shutRoomsAt(show, cue.at + 0.05).find((s) => s.room === cue.event.room)!;
        expect(span).toMatchObject({ room: cue.event.room, by: cue.event.by, start: cue.at });
        // 閉まっている長さは、試合の中の時間で数える（絵をゆっくり流す所では、上映の時間はのびる）
        const roam = roamAt(show, span.start)!;
        expect(roamClockAt(roam, Math.min(span.end, roam.end - (roam.held ?? 0))) - roamClockAt(roam, span.start)).toBeLessThanOrEqual(log.roam!.config.doorSeconds + 1e-6);
        expect(shutRoomsAt(show, span.end + 1e-4).some((s) => s.start === span.start)).toBe(false);
        // 自分で開いたか、集会が始まって開いたか、試合が終わったか
        const opened = cuesOf(show, 'door_open').some((open) => open.event.room === span.room && Math.abs(open.at - span.end) < 1e-6);
        const cleared = show.segments.some((s) => (s.kind === 'meeting' || s.kind === 'ending') && Math.abs(s.start - span.end) < 1e-6);
        expect(opened || cleared, `${seed} ${span.room}`).toBe(true);
      }
    }
    expect(shut).toBeGreaterThan(0);
  });

  it('持ち場の人は動かず、床下の人は、入った所から出る所へ進む', async () => {
    let working = 0;
    let passed = 0;
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      const tick = log.roam!.config.tickSeconds;
      for (const roam of roamsOf(show)) {
        for (const [index, frame] of roam.frames.entries()) {
          if (index % 7 !== 0) continue;
          const poses = posesAt(show, roam, showTimeOf(roam, roam.clock0 + index * tick + 1e-6));
          poses.forEach((pose, seat) => {
            expect(pose.state).toBe(frame.st[seat]);
            expect(isUp(pose)).toBe(frame.st[seat] === 'a' || frame.st[seat] === 'w');
            if (pose.state === 'w') {
              working++;
              expect(pose.moving).toBe(false);
            }
          });
        }
      }
      expect(show.sneaks.length).toBe(cuesOf(show, 'sneak').filter((cue) => cue.event.phase === 'in').length);
      for (const span of show.sneaks) {
        const roam = roamAt(show, span.start)!;
        expect(span.end).toBeGreaterThan(span.start);
        expect(span.seat).toBe(log.seats.indexOf(span.by));
        expect(big.hatches.some((hatch: { x: number; y: number }) => hatch.x + 0.5 === span.from.x && hatch.y + 0.5 === span.from.y)).toBe(true);
        if (!span.to) {
          // 集会が始まって、途中で出てきた
          expect(show.segments.some((s) => s.kind !== 'roam' && Math.abs(s.start - span.end) < 1e-6)).toBe(true);
          continue;
        }
        passed++;
        const length = Math.hypot(span.to.x - span.from.x, span.to.y - span.from.y);
        let gone = 0;
        for (let step = 1; step <= 9; step++) {
          const k = step / 10;
          const pose = posesAt(show, roam, span.start + (span.end - span.start) * k)[span.seat]!;
          expect(pose.state, `${seed} ${span.by} ${k}`).toBe('u');
          const fromStart = Math.hypot(pose.x - span.from.x, pose.y - span.from.y);
          // 入口と出口を結ぶ線の上を、戻らずに進む
          expect(fromStart + Math.hypot(pose.x - span.to.x, pose.y - span.to.y)).toBeCloseTo(length, 6);
          expect(fromStart).toBeGreaterThanOrEqual(gone);
          gone = fromStart;
        }
        expect(gone).toBeGreaterThan(length * 0.9);
      }
    }
    expect(working).toBeGreaterThan(50);
    expect(passed).toBeGreaterThan(0);
  });

  it('心だけの姿は、ずんだ餅になった従業員にだけ出る（妖精と妖精マニアには出ない）', async () => {
    let dreams = 0;
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      const nibblers = new Set(log.players.filter((p) => p.role !== 'artisan').map((p) => p.name));
      const naps = cuesOf(show, 'nap');
      for (const roam of roamsOf(show)) {
        for (let time = roam.start; time < roam.end; time += 3.3) {
          const poses = posesAt(show, roam, time);
          ghostsAt(show, roam, time).forEach((ghost, seat) => {
            if (!ghost) return;
            dreams++;
            const name = log.seats[seat]!;
            // 餅になった体は、見つかって集会が開かれると運び出される（記録の上では x になる）。心だけの姿は、そのあとも続く
            expect(isUp(poses[seat])).toBe(false);
            expect(naps.some((cue) => cue.event.target === name && cue.at <= time + 1e-6), `${seed} ${name} ${time}`).toBe(true);
            expect(nibblers.has(name)).toBe(false);
            expect(ghost.x).toBeGreaterThan(0);
            expect(ghost.y).toBeGreaterThan(0);
          });
        }
      }
    }
    expect(dreams).toBeGreaterThan(20);
  });

  it('鐘で開いた集会と、新しい終わり方が、時間軸に乗る', async () => {
    const whys = new Set<string>();
    let bells = 0;
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      whys.add(log.result!.why);
      expect(show.segments.at(-1)).toMatchObject({ kind: 'ending' });
      for (const cue of cuesOf(show, 'bell')) {
        bells++;
        // 鐘のあと、最後の声（案内役の一言も）が言い終わるまで待ってから集会になる
        const meeting = show.segments.find((s) => s.kind === 'meeting' && s.start >= cue.at - 1e-6);
        expect(meeting!.start - cue.at).toBeLessThanOrEqual(9);
        expect(meeting).toMatchObject({ info: { kind: 'bell', reporter: cue.event.by, found: null, room: null } });
      }
    }
    expect(bells).toBeGreaterThan(0);
    // 工房のマップには制限時間が無い（2026-11-19）ので、late（開店に間に合わない）は起きない
    expect([...whys]).toContain('tasks_done');
  });

  it('仕込みの無い記録や、古い形の記録でも、空のまま時間軸を作れる', async () => {
    const plain = await runMatch({ seed: 5, map: small, players: 5, brains: [null], denyList: [] });
    const modern = await play(12);
    // 古い記録: 仕込みの数も、心だけの姿の位置も、持ち場も無い
    const { taskTotal: _total, steps: _steps, ...roam } = modern.roam!;
    const old = {
      ...modern,
      roam: { ...roam, frames: roam.frames.map(({ gp: _gp, ...frame }) => frame), map: { name: big.name, corridor: big.corridor, rooms: big.rooms, halls: big.halls, rows: big.rows, spawn: big.spawn } },
      events: modern.events.filter((event) => !['task', 'sabotage', 'fixed', 'door_open', 'sneak', 'bell'].includes(event.type)).map((event) => (event.type === 'round_start' ? { type: event.type, t: event.t, round: event.round } : event.type === 'game_over' ? { type: event.type, t: event.t, winner: event.winner, why: event.why } : event)),
    } as unknown as MatchLog;
    for (const log of [plain, old]) {
      const show = buildShow(log, null);
      expect(show.total).toBeGreaterThan(10);
      expect([show.progress, show.troubles, show.shuts, show.sneaks]).toEqual([[], [], [], []]);
      for (const time of [0, show.total / 2, show.total]) {
        expect(progressAt(show, time)).toBeNull();
        expect(troubleAt(show, time)).toBeNull();
        expect(shutRoomsAt(show, time)).toEqual([]);
      }
      const first = roamsOf(show)[0]!;
      expect(ghostsAt(show, first, first.start + 5).every((ghost) => ghost === null)).toBe(true);
      expect(posesAt(show, first, first.start + 5)).toHaveLength(log.seats.length);
    }
  });
});

describe('カメラの係（11人・妖精2人・妖精マニア1人）', () => {
  const sites: Sites = {
    rooms: Object.fromEntries(Object.entries(doorRectsOf(big)).map(([room, doors]) => [room, { x: doors[0]!.x + 0.5, y: doors[0]!.y + 0.5 }])),
    fix: {
      lights: big.fixPoints.filter((p: { for: string }) => p.for === 'lights').map((p: { x: number; y: number }) => ({ x: p.x + 0.5, y: p.y + 0.5 })),
      crisis: big.fixPoints.filter((p: { for: string }) => p.for === 'crisis').map((p: { x: number; y: number }) => ({ x: p.x + 0.5, y: p.y + 0.5 })),
    },
  };
  async function stage(seed: number) {
    const log = await play(seed);
    const show = buildShow(log, null);
    const cast = log.seats.map((name, seat) => ({ seat, name, nibbler: log.players.find((player) => player.name === name)?.role === 'nibbler' }));
    const director = new Director(show, cast, big.rows[0].length, big.rows.length, sites);
    return { log, show, cast, director, roams: roamsOf(show) };
  }

  it('場面は、見回りの始まりから終わりまで、すき間も重なりもなく並ぶ', async () => {
    for (const seed of SEEDS) {
      const { director, roams, cast } = await stage(seed);
      expect(cast.filter((c) => c.nibbler)).toHaveLength(2);
      for (const secrets of [true, false]) {
        for (const roam of roams) {
          const shots = director.shotsFor(roam, secrets);
          expect(shots[0]!.start).toBeCloseTo(roam.start, 6);
          expect(shots.at(-1)!.end).toBeCloseTo(roam.end, 6);
          shots.reduce((end, shot) => {
            expect(shot.start).toBeCloseTo(end, 6);
            expect(shot.end).toBeGreaterThan(shot.start);
            return shot.end;
          }, roam.start);
        }
      }
    }
  });

  it('妨害の始まり・直す場面・抜け道・鐘を鳴らす人を拾う', async () => {
    const whys = new Map<string, number>();
    let places = 0;
    for (const seed of SEEDS) {
      const { show, director, roams, cast } = await stage(seed);
      const seatOf = (name: string) => cast.find((c) => c.name === name)!.seat;
      for (const roam of roams) {
        const shots = director.shotsFor(roam, true);
        for (const shot of shots) {
          whys.set(shot.why, (whys.get(shot.why) ?? 0) + 1);
          const inside = <T extends MatchLog['events'][number]['type']>(type: T) => cuesOf(show, type).filter((cue) => cue.at >= shot.start - 1e-6 && cue.at <= shot.end + 1e-6);
          if (shot.why === 'fix') {
            // その困りごとを直した人を、直るまでの間か、直った瞬間に映している（2人で直す時は、順に映す）
            const span = show.troubles.find((trouble) => trouble.how === 'fixed' && trouble.fixedBy.map(seatOf).includes(shot.subject) && shot.end > trouble.start && shot.start <= trouble.end + 1e-6);
            expect(span, `${seed} ${shot.start}`).toBeDefined();
            if (span!.fixedBy.length === 1) expect(inside('fixed').some((cue) => Math.abs(cue.at - span!.end) < 1e-6)).toBe(true);
          } else if (shot.why === 'sabotage') {
            // 妨害が始まった瞬間か、その直後（前の見どころが終わってすぐ）から映している
            const started = cuesOf(show, 'sabotage').filter((cue) => cue.at >= shot.start - 0.25 && cue.at <= shot.end);
            expect(started.length, `${seed} ${shot.start}`).toBeGreaterThan(0);
            if (shot.kind === 'place') {
              places++;
              const door = started.find((cue) => cue.event.what === 'door')!;
              expect(shot.at).toEqual(sites.rooms![door.event.room!]);
              const camera = director.cameraAt(roam, (shot.start + shot.end) / 2, true);
              expect(camera.subject).toBeNull();
            }
          } else if (shot.why === 'sneak') {
            // 床下へもぐる所か、出てくる所を妖精でない人に見られた瞬間（2026-11-22 から。見た人と一緒に映す）
            const dive = show.sneaks.some((span) => span.seat === shot.subject && span.start >= shot.start - 1e-6 && span.start <= shot.end);
            const seenExit = shot.kind === 'pair' && show.sneaks.some((span) => span.seat === shot.subject && span.seenOut.length > 0 && span.end >= shot.start - 1e-6 && span.end <= shot.end + 1e-6);
            expect(dive || seenExit).toBe(true);
          } else if (shot.why === 'bell') {
            // 鐘のあと、最後の声が言い終わるまで絵を止めて待つ分（held）を除いた所が、鐘を鳴らした時刻
            const bell = cuesOf(show, 'bell').find((cue) => Math.abs(cue.at - (roam.end - (roam.held ?? 0))) < 1e-6)!;
            expect(shot.subject).toBe(seatOf(bell.event.by));
            expect(shot.end).toBeCloseTo(roam.end, 6);
          }
        }
      }
    }
    for (const why of ['sabotage', 'fix', 'sneak', 'bell']) expect(whys.get(why) ?? 0, why).toBeGreaterThan(0);
    expect(places).toBeGreaterThan(0);
  });

  it('見回りを順に追う時は、起きている妖精を、かわるがわる映す', async () => {
    // 2人とも起きていて、順に追う場面が何度もある種（公開版の登場人物で選んだ）。
    // 話している所のあいだは、よそへ飛ばずに映し続けるので（director.ts の HOLD_SECONDS）、順に追う場面は少ない。試合を通して、2人とも映す
    const { director, roams, cast } = await stage(51);
    const nibblers = cast.filter((c) => c.nibbler).map((c) => c.seat);
    const patrol = roams.flatMap((roam) => director.shotsFor(roam, true).filter((shot) => shot.why === 'patrol').map((shot) => shot.subject));
    for (const seat of nibblers) expect(patrol).toContain(seat);
    // 続けて同じ人は追わない。従業員も、あいだに映す
    for (const seed of SEEDS) {
      const staged = await stage(seed);
      for (const roam of staged.roams) {
        const shots = staged.director.shotsFor(roam, true);
        shots.forEach((shot, index) => {
          const before = shots[index - 1];
          if (shot.why === 'patrol' && before?.why === 'patrol') expect(shot.subject, `${seed} ${shot.start}`).not.toBe(before.subject);
        });
      }
    }
    // 役職を隠す時は、妖精をひいきしない: 順に追う相手が、妖精ばかりにならない
    const plain = roams.flatMap((roam) => director.shotsFor(roam, false).filter((shot) => shot.why === 'patrol').map((shot) => shot.subject));
    expect(plain.filter((seat) => !nibblers.includes(seat)).length).toBeGreaterThan(plain.length / 2);
  });

  it('話している所へは、遠くへ飛んでから HOLD_SECONDS たつまで、ぱっと切り替えない（瞬間移動を減らす）', async () => {
    for (const seed of SEEDS) {
      const { director, roams } = await stage(seed);
      for (const roam of roams) {
        const shots = director.shotsFor(roam, true);
        let lastJump = roam.start;
        for (const shot of shots.slice(1)) {
          const jumped = Number.isFinite(director.cameraAt(roam, shot.start + 1e-4, true).sinceCut);
          if (!jumped) continue;
          if (shot.why === 'chat') expect(shot.start - lastJump, `${seed} ${shot.start}`).toBeGreaterThanOrEqual(HOLD_SECONDS - 0.01);
          lastJump = shot.start;
        }
      }
    }
  });

  it('役職を隠す時は、抜け道の場面を作らず、床下にいる人を追わない', async () => {
    for (const seed of SEEDS) {
      const { show, director, roams } = await stage(seed);
      for (const roam of roams) {
        const shots = director.shotsFor(roam, false);
        expect(shots.filter((shot) => shot.why === 'sneak')).toEqual([]);
        for (const shot of shots) {
          if (shot.kind !== 'follow') continue;
          for (let time = shot.start; time < shot.end; time += 0.2) {
            expect(posesAt(show, roam, time)[shot.subject]!.state, `${seed} ${shot.why} ${time}`).not.toBe('u');
          }
        }
      }
    }
  });

  it('追っている人は、床下にいる間も、いつも画面の空いている所にいる', async () => {
    for (const seed of [2, 12]) {
      const { show, director, roams } = await stage(seed);
      for (const roam of roams) {
        for (const shot of director.shotsFor(roam, true)) {
          if (shot.kind === 'overview' || shot.kind === 'place') continue;
          for (let time = shot.start + 1.8; time < shot.end; time += 0.37) {
            const camera = director.cameraAt(roam, time, true);
            const pose = posesAt(show, roam, time)[shot.subject]!;
            const sx = ANCHOR_X + (pose.x - camera.x) * camera.zoom;
            const sy = ANCHOR_Y + (pose.y - camera.y) * camera.zoom;
            expect(sx, `${seed} ${shot.why} ${time}`).toBeGreaterThan(20);
            expect(sx, `${seed} ${shot.why} ${time}`).toBeLessThan(W - 440);
            expect(sy, `${seed} ${shot.why} ${time}`).toBeGreaterThan(96);
            expect(sy, `${seed} ${shot.why} ${time}`).toBeLessThan(H - 150);
          }
        }
      }
    }
  });

  it('カメラは時刻だけで決まる（逆の順に尋ねても同じ）', async () => {
    const { director, roams } = await stage(12);
    const again = (await stage(12)).director;
    for (const roam of roams.slice(0, 2)) {
      const times: number[] = [];
      for (let time = roam.start; time < roam.end; time += 1 / 15) times.push(time);
      const forward = times.map((time) => director.cameraAt(roam, time, true));
      const backward = [...times].reverse().map((time) => again.cameraAt(roam, time, true)).reverse();
      forward.forEach((camera, i) => {
        expect([camera.x, camera.y, camera.zoom, camera.subject]).toEqual([backward[i]!.x, backward[i]!.y, backward[i]!.zoom, backward[i]!.subject]);
      });
    }
  });
});

describe('11人の名前と言い回し', () => {
  it('11人の色は、どの2人も見分けがつく', async () => {
    const log = await play(3);
    const colors = log.seats.map((name, seat) => colorOf(name, seat).main);
    expect(new Set(colors).size).toBe(11);
    const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
    for (const [i, a] of colors.entries()) {
      for (const b of colors.slice(i + 1)) {
        const [p, q] = [rgb(a), rgb(b)];
        expect(Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!, p[2]! - q[2]!), `${a} ${b}`).toBeGreaterThan(60);
      }
    }
  });

  it('内心に混ざった新しい行動の名前も、ふつうの言葉に直す', () => {
    expect(plainThought('do_task を続ける。困りごとが出たら fix に行く')).toBe('「仕込み」を続ける。困りごとが出たら「直す」に行く');
    expect(plainThought('見られたので call_meeting する')).toBe('見られたので「鐘を鳴らす」する');
    expect(plainThought('sabotage のあと sneak で離れる')).toBe('「妨害」のあと「抜け道」で離れる');
    // ほかの語の一部になっている英字は、そのまま
    expect(plainThought('prefix と napkin')).toBe('prefix と napkin');
  });
});

describe('ずんだの妖精・妖精マニア・狐', () => {
  it('妖精マニアと狐には、従業員とも妖精とも違う色と呼び名がある', () => {
    expect(ROLE_LABEL).toEqual({ artisan: '従業員', nibbler: 'ずんだの妖精', madman: '妖精マニア', fox: '狐', seer: '占い師' });
    expect(ROLE_SHORT.nibbler).toBe('妖精');
    expect(new Set([ROLE_COLOR.artisan, ROLE_COLOR.nibbler, ROLE_COLOR.madman, ROLE_COLOR.fox, ROLE_COLOR.seer]).size).toBe(5);
    expect(SIDE_OF).toEqual({ artisan: 'artisan', nibbler: 'nibbler', madman: 'nibbler', fox: 'fox', seer: 'artisan' });
    expect(ejectVerdict('seer')).toEqual(ejectVerdict('artisan'));
    expect(ejectTruth('seer', true)).toBe('本当は占い師');
    // クビになった狐は、全員に「狐だった」と知らされる（2026-11-21 から）。全員に知らされたことと同じなので、観戦者だけの付箋は出さない
    expect(ejectVerdict('fox')).toEqual({ text: '狐だった', fairy: false, fox: true });
    expect(ejectTruth('fox', true)).toBeNull();
  });

  it('クビになった妖精マニアは、全員には従業員と同じ「妖精ではなかった」と出て、観戦者にだけ本当の役職が出る', async () => {
    let found = 0;
    // 妖精マニアがクビになる種（2026-11-19、工房の道具を足した時に選び直した。2026-11-21 夜、焚きすぎの直す場所を氷室へ移して 17・37 に、同じ夜に仕込みの配り方を変えて 2・22、仕込みを3つずつ出す決まりにして 41・74 に選び直した）
    // 2026-11-22、餅のすぐそばまで歩いてから知らせる決まりにして、113・169 に選び直した
    for (const seed of [113, 169]) {
      const log = await play(seed, true);
      const withMadman = log.players.some((p) => p.role === 'madman');
      expect(withMadman).toBe(true);
      for (const event of log.events) {
        if (event.type !== 'meeting_end' || event.ejectedRole !== 'madman') continue;
        found++;
        expect(ejectVerdict('madman')).toEqual(ejectVerdict('artisan'));
        expect(ejectVerdict('madman').text).toBe('妖精ではなかった');
        expect(ejectTruth('madman', withMadman)).toBe('本当は妖精マニア');
      }
    }
    expect(found).toBeGreaterThan(0);
    expect(ejectVerdict('nibbler')).toEqual({ text: '妖精だった', fairy: true, fox: false });
    expect(ejectTruth('nibbler', true)).toBeNull();
    // 妖精マニアのいない試合では、従業員だったことは「妖精ではなかった」で分かるので、重ねて出さない
    expect(ejectTruth('artisan', false)).toBeNull();
    expect(ejectTruth('artisan', true)).toBe('従業員だった');
  });

  it('前の題材の記録（行動の名前が nap、妖精マニアがいない）でも、時間軸を作れる', async () => {
    const modern = await play(9);
    const old = {
      ...modern,
      players: modern.players.map((p) => ({ ...p, role: p.role === 'madman' ? 'artisan' : p.role })),
      truth: { nibbler: modern.truth.nibbler },
      events: modern.events.map((event) => {
        if (event.type === 'decide' && event.action.startsWith('transform')) return { ...event, action: event.action.replace('transform', 'nap') };
        if (event.type === 'meeting_end' && event.ejectedRole === 'madman') return { ...event, ejectedRole: 'artisan' };
        return event;
      }),
    } as unknown as MatchLog;
    const show = buildShow(old, null);
    // 違いは、妖精が「ねらっている」という案内役の一言（新しい行動の名前の時だけ言う）で、見回りの終わりの待ちと、声が詰まった所で絵をゆっくり流す分が変わるだけ
    expect(Math.abs(show.total - buildShow(modern, null).total)).toBeLessThan(25);
    expect(show.cues.filter((cue) => cue.event.type === 'decide' && cue.event.action.startsWith('nap')).length).toBeGreaterThan(0);
    const sites: Sites = {
      rooms: Object.fromEntries(Object.entries(doorRectsOf(big)).map(([room, doors]) => [room, { x: doors[0]!.x + 0.5, y: doors[0]!.y + 0.5 }])),
      fix: { lights: [], crisis: [] },
    };
    const director = new Director(show, old.seats.map((name, seat) => ({ seat, name, nibbler: old.players.find((p) => p.name === name)?.role === 'nibbler' })), big.rows[0].length, big.rows.length, sites);
    const shots = roamsOf(show).flatMap((roam) => director.shotsFor(roam, true));
    expect(shots.some((shot) => shot.why === 'nap')).toBe(true);
  });

  it.skipIf(!existsSync(OLD_REAL))('保存してある前の題材の実物の記録（m43）も、時間軸を作れる', () => {
    const log = JSON.parse(readFileSync(OLD_REAL, 'utf8')) as MatchLog;
    const show = buildShow(log, null);
    expect(show.segments.at(-1)?.kind).toBe('ending');
    expect(show.total).toBeGreaterThan(60);
  });
});
