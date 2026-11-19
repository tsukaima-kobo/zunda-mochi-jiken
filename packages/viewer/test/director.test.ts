// カメラの係: 誰をいつ映すかが、記録だけから決まり、見どころを外さないこと。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../server/src/index.ts';
import { ANCHOR_X, ANCHOR_Y, Director, ZOOM } from '../src/director.ts';
import { buildShow, posesAt } from '../src/show.ts';
import type { RoamSegment, Show } from '../src/show.ts';
import { H, W } from '../src/theme.ts';

const load = (name: string) => JSON.parse(readFileSync(path.resolve(import.meta.dirname, `../../../content/maps/${name}.json`), 'utf8'));
const big = load('workshop');
const small = load('workshop-small');

async function stage(seed: number, map = big, players = 6): Promise<{ show: Show; director: Director; roams: RoamSegment[]; seatOf: (name: string) => number }> {
  const log = await runMatch({ seed, map, players, brains: [null], denyList: [] });
  const show = buildShow(log, null);
  // 席の番号は、記録の位置の並び（log.seats）の順
  const cast = log.seats.map((name, seat) => ({ seat, name, nibbler: log.players.find((player) => player.name === name)?.role === 'nibbler' }));
  const director = new Director(show, cast, map.rows[0].length, map.rows.length);
  const roams = show.segments.filter((s): s is RoamSegment => s.kind === 'roam');
  return { show, director, roams, seatOf: (name) => cast.find((c) => c.name === name)!.seat };
}

describe('カメラの係（広いマップ）', () => {
  it('場面は、見回りの始まりから終わりまで、すき間も重なりもなく並ぶ', async () => {
    for (const seed of [1, 3, 8, 21]) {
      const { director, roams } = await stage(seed);
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

  it('ずんだ餅に変える場面は、変える妖精と変えられる人を、変える前から寄って映す', async () => {
    let naps = 0;
    for (const seed of [1, 3, 8, 21]) {
      const { show, director, roams, seatOf } = await stage(seed);
      for (const roam of roams) {
        const shots = director.shotsFor(roam, true);
        for (const cue of show.cues) {
          if (cue.event.type !== 'nap' || cue.at < roam.start || cue.at > roam.end) continue;
          naps++;
          const shot = shots.find((s) => cue.at >= s.start && cue.at < s.end + 1e-6)!;
          expect(shot.why).toBe('nap');
          expect(shot.kind).toBe('pair');
          expect(shot.subject).toBe(seatOf(cue.event.by));
          expect(shot.other).toBe(seatOf(cue.event.target));
          // 見回りが始まってすぐの時や、前の見どころの直後でなければ、2秒より前から映している
          const before = shots[shots.indexOf(shot) - 1];
          if (cue.at - roam.start > 8 && before?.why !== 'nap' && before?.why !== 'report') expect(cue.at - shot.start).toBeGreaterThan(2);
          // その瞬間、2人とも画面の空いている所に入っている
          const camera = director.cameraAt(roam, cue.at, true);
          expect(camera.zoom).toBeGreaterThan(ZOOM.follow - 0.01);
          const poses = posesAt(show, roam, cue.at);
          for (const seat of [shot.subject, shot.other]) {
            const sx = ANCHOR_X + (poses[seat]!.x - camera.x) * camera.zoom;
            const sy = ANCHOR_Y + (poses[seat]!.y - camera.y) * camera.zoom;
            expect(sx).toBeGreaterThan(20);
            expect(sx).toBeLessThan(W - 440);
            expect(sy).toBeGreaterThan(96);
            expect(sy).toBeLessThan(H - 150);
          }
        }
      }
    }
    expect(naps).toBeGreaterThan(4);
  });

  it('役職を隠す時は、渡す前に、渡す人や狙われる人を特別に映さない', async () => {
    for (const seed of [1, 3, 8, 21]) {
      const { show, director, roams, seatOf } = await stage(seed);
      for (const roam of roams) {
        const shots = director.shotsFor(roam, false);
        // 話している所（声は役職に関係なく聞こえている）は、話している2人を一緒に映してよい
        expect(shots.filter((s) => s.why !== 'chat' && (s.kind === 'pair' || s.why === 'target'))).toEqual([]);
        for (const shot of shots.filter((s) => s.why === 'chat')) {
          // ほかの見どころに削られても、声の鳴っている間と重なっている
          const said = show.cues.filter((c) => c.event.type === 'chat' && c.voiced && c.at < shot.end + 1e-6 && c.end > shot.start - 1e-6);
          expect(said.length).toBeGreaterThan(0);
          expect(said.map((c) => seatOf((c.event as { speaker: string }).speaker))).toContain(shot.subject);
        }
        for (const shot of shots.filter((s) => s.why === 'nap')) {
          const cue = show.cues.find((c) => c.event.type === 'nap' && c.at >= shot.start - 1e-6 && c.at <= shot.end)!;
          expect(cue, '渡した瞬間より前からは寄らない').toBeDefined();
          expect(cue.at - shot.start).toBeLessThan(0.5);
          if (cue.event.type === 'nap') expect(shot.subject).toBe(seatOf(cue.event.target));
        }
      }
    }
  });

  it('追っている人は、いつも画面の空いている所に映っている', async () => {
    for (const seed of [3, 21]) {
      const { show, director, roams } = await stage(seed);
      for (const roam of roams) {
        for (const shot of director.shotsFor(roam, true)) {
          if (shot.kind === 'overview' || shot.kind === 'place') continue;
          // つなぎが終わったあと
          for (let time = shot.start + 1.8; time < shot.end; time += 0.37) {
            const camera = director.cameraAt(roam, time, true);
            const pose = posesAt(show, roam, time)[shot.subject]!;
            const sx = ANCHOR_X + (pose.x - camera.x) * camera.zoom;
            const sy = ANCHOR_Y + (pose.y - camera.y) * camera.zoom;
            expect(sx, `${seed} ${time}`).toBeGreaterThan(20);
            expect(sx, `${seed} ${time}`).toBeLessThan(W - 440);
            expect(sy, `${seed} ${time}`).toBeGreaterThan(96);
            expect(sy, `${seed} ${time}`).toBeLessThan(H - 150);
          }
        }
      }
    }
  });

  it('カメラは時刻だけで決まり、切り替えの瞬間のほかは、なめらかに動く', async () => {
    const { director, roams } = await stage(3);
    const again = (await stage(3)).director;
    const step = 1 / 60;
    let cuts = 0;
    for (const roam of roams) {
      const times: number[] = [];
      for (let time = roam.start; time < roam.end - step; time += step) times.push(time);
      // 逆の順に尋ねても、同じ答えになる
      const forward = times.map((time) => director.cameraAt(roam, time, true));
      const backward = [...times].reverse().map((time) => again.cameraAt(roam, time, true)).reverse();
      forward.forEach((camera, i) => {
        expect(camera.x).toBe(backward[i]!.x);
        expect(camera.y).toBe(backward[i]!.y);
        expect(camera.zoom).toBe(backward[i]!.zoom);
      });
      for (let i = 1; i < forward.length; i++) {
        const a = forward[i - 1]!;
        const b = forward[i]!;
        if (b.sinceCut < step + 1e-6) {
          cuts++;
          continue;
        }
        expect(Math.hypot(b.x - a.x, b.y - a.y), `${times[i]}`).toBeLessThan(1);
        expect(Math.abs(Math.log(b.zoom / a.zoom)), `${times[i]}`).toBeLessThan(0.08);
      }
    }
    // 離れた場所へは、ぱっと切り替える（広いマップなので、何度かは起きる）
    expect(cuts).toBeGreaterThan(0);
  });
});

describe('カメラの係（小さいマップ）', () => {
  it('全体が大きく映るマップでは、カメラを動かさない', async () => {
    const { director, roams } = await stage(3, small, 5);
    const roam = roams[0]!;
    const first = director.cameraAt(roam, roam.start, true);
    expect(first.zoom).toBeGreaterThanOrEqual(44);
    for (let time = roam.start; time < roam.end; time += 0.5) {
      const camera = director.cameraAt(roam, time, true);
      expect(camera.x).toBeCloseTo(first.x, 9);
      expect(camera.y).toBeCloseTo(first.y, 9);
      expect(camera.zoom).toBeCloseTo(first.zoom, 9);
    }
  });
});
