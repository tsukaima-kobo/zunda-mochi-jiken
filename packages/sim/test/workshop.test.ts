// 広い工房のマップ（content/maps/workshop.json）と、広いマップのための決まり。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { actorById, applyRoamIntent, areaAt, buildRoamObservation, centerOf, createRoamWorld, findPath, findRoute, hasLineOfSight, isWalkable, nameOf, parseMap, playerById, stepRoam, visibleTo } from '../src/index.ts';
import type { MapDefinition, Point } from '../src/index.ts';

const mapDef = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../content/maps/workshop.json'), 'utf8')) as MapDefinition;
const map = parseMap(mapDef);
const middle = (name: string) => {
  const tiles = map.roomTiles[name] as Point[];
  return tiles[Math.floor(tiles.length / 2)] as Point;
};

describe('広い工房のマップ', () => {
  it('部屋が16、廊下が4本あり、どの場所からどの場所へも道がある', () => {
    expect(map.width).toBe(72);
    expect(map.height).toBe(46);
    expect(Object.keys(mapDef.rooms)).toHaveLength(16);
    expect(Object.keys(mapDef.halls ?? {})).toHaveLength(4);
    expect(map.roomNames).toHaveLength(20);
    const start = middle('中庭');
    for (const name of map.roomNames) {
      expect((map.roomTiles[name] as Point[]).length, name).toBeGreaterThan(40);
      expect(findPath(map, start, middle(name)), name).not.toBeNull();
    }
  });

  it('名前の無い通路は無く、どの升目も部屋か廊下の名前を持つ', () => {
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        if (isWalkable(map, x, y)) expect(map.roomNames, `${x},${y}`).toContain(areaAt(map, centerOf({ x, y })));
      }
    }
  });

  it('隣り合う場所は互いに行き来でき、行き止まりの部屋もある', () => {
    for (const [name, next] of Object.entries(map.links)) {
      for (const other of next) expect(map.links[other], `${other} → ${name}`).toContain(name);
    }
    expect(map.links['氷室']).toEqual(['西の廊下']);
    expect(map.links['機械室']).toEqual(['東の廊下']);
    expect(map.links['中庭']).toEqual(['餅つき場', 'あんこ場', 'ずんだ場', '北の廊下', '南の廊下']);
    // 北の廊下と西の廊下は、枝豆畑を通らないと行き来できない
    expect(map.links['北の廊下']).not.toContain('西の廊下');
    expect(map.links['枝豆畑']).toEqual(['北の廊下', '西の廊下']);
  });

  it('端から端まで歩くと、見える距離の何倍もある', () => {
    expect(map.span).toBeGreaterThan(60);
    expect(mapDef.settings?.visionRadius).toBe(11);
    expect(map.span / (mapDef.settings?.visionRadius ?? 1)).toBeGreaterThan(5);
  });

  it('家具は通れないが、見通しはさえぎらない。壁は見通しをさえぎる', () => {
    // 蒸し場のかまど（44〜49, 3〜4）
    expect(isWalkable(map, 45, 3)).toBe(false);
    expect(hasLineOfSight(map, centerOf({ x: 43, y: 3 }), centerOf({ x: 50, y: 3 }))).toBe(true);
    expect(findPath(map, { x: 43, y: 3 }, { x: 50, y: 3 })?.length).toBeGreaterThan(7);
    // 洗い場と蒸し場のあいだの壁（x = 37）。戸口（y = 4〜5）ごしには見える
    expect(hasLineOfSight(map, centerOf({ x: 35, y: 7 }), centerOf({ x: 39, y: 7 }))).toBe(false);
    expect(hasLineOfSight(map, centerOf({ x: 35, y: 4 }), centerOf({ x: 39, y: 4 }))).toBe(true);
  });

  it('道は、まっすぐ歩ける所では斜めにも進み、壁や家具をかすめない', () => {
    // 中庭の何も無い所を斜めに横切る: 升目に沿った道よりずっと少ない点で着く
    const from = centerOf({ x: 31, y: 18 });
    const to = centerOf({ x: 35, y: 20 });
    expect(findRoute(map, from, to)).toEqual([to]);
    // 北の廊下から休憩室へ: 通る線のどこも、壁や家具から体の幅だけ離れている
    const route = findRoute(map, centerOf({ x: 25, y: 11 }), centerOf(middle('休憩室'))) as Point[];
    expect(route.length).toBeGreaterThan(1);
    let at = centerOf({ x: 25, y: 11 });
    let walked = 0;
    for (const next of route) {
      const distance = Math.hypot(next.x - at.x, next.y - at.y);
      for (let d = 0; d <= distance; d += 0.1) {
        const x = at.x + ((next.x - at.x) * d) / Math.max(distance, 1e-9);
        const y = at.y + ((next.y - at.y) * d) / Math.max(distance, 1e-9);
        for (const dx of [-0.25, 0.25]) for (const dy of [-0.25, 0.25]) expect(isWalkable(map, Math.floor(x + dx), Math.floor(y + dy)), `${x},${y}`).toBe(true);
      }
      walked += distance;
      at = next;
    }
    // 升目に沿って歩くより短い
    expect(walked).toBeLessThan((findPath(map, { x: 25, y: 11 }, middle('休憩室')) as Point[]).length);
  });
});

describe('広いマップでの試合', () => {
  const world = (seed = 1) => createRoamWorld({ seed, map: mapDef, players: 6 });

  it('マップに合わせた決まり（制限時間なし・見える距離・歩く速さ）が使われ、試合ごとの指定が優先される', () => {
    expect(world().roam).toMatchObject({ roamSeconds: 1800, deadline: 0, visionRadius: 11, napCooldown: 25, speed: 5, dutySteps: 14 });
    expect(createRoamWorld({ seed: 1, map: mapDef, players: 6, roam: { roamSeconds: 90 } }).roam).toMatchObject({ roamSeconds: 90, visionRadius: 11 });
  });

  it('全員が中庭の鐘のまわりから始まり、観測には間取りが入る（座標は入らない）', () => {
    const w = world();
    for (const actor of w.actors) expect(areaAt(w.map, actor.pos)).toBe('中庭');
    const obs = buildRoamObservation(w, w.roster[0] as string);
    expect(obs.where).toBe('中庭');
    expect(obs.rooms).toEqual(map.roomNames);
    expect(obs.layout).toContain('氷室: 西の廊下');
    expect(obs.layout).toHaveLength(20);
    expect(obs.crossSeconds).toBeGreaterThanOrEqual(15);
    expect(JSON.stringify(obs)).not.toMatch(/"x":|"y":|"pos"/);
  });

  it('離れた部屋へは何秒もかかり、遠くの相手は見えない', () => {
    const w = world();
    const [walker, stayer] = w.roster as [string, string];
    applyRoamIntent(w, walker, { action: 'move_to', target: '氷室' });
    let ticks = 0;
    while (actorById(w, walker).task !== null && ticks < 2000) {
      stepRoam(w);
      ticks++;
    }
    expect(areaAt(w.map, actorById(w, walker).pos)).toBe('氷室');
    expect(buildRoamObservation(w, walker).lastResult).toBe('氷室 に着いた');
    // 中庭から氷室まで、6秒より長くかかる（歩く速さは毎秒5升）
    expect(w.clock).toBeGreaterThan(6);
    expect(visibleTo(w, walker)).not.toContain(stayer);
    expect(visibleTo(w, stayer)).not.toContain(walker);
  });
});

describe('工房の道具（シフト表・ずんだ餅ボード・防犯カメラ）', () => {
  const setup = (seed = 3) => {
    const w = createRoamWorld({ seed, map: mapDef, players: 6 });
    const put = (id: string, tile: Point) => {
      const actor = actorById(w, id);
      actor.pos = centerOf(tile);
      actor.path = [];
    };
    const runUntilIdle = (id: string) => {
      let n = 0;
      while (actorById(w, id).task !== null && w.result === null && n < 4000) {
        stepRoam(w);
        n++;
      }
    };
    const watching = (id: string) => {
      const task = actorById(w, id).task;
      return task?.kind === 'look' && task.until !== null;
    };
    return { w, put, runUntilIdle, watching, name: (id: string) => nameOf(w, id) };
  };
  const ice = middle('氷室');
  const devices = mapDef.devices as NonNullable<MapDefinition['devices']>;

  it('3つの道具は、マップに書いた部屋の、歩いて行ける升目にあり、観測には名前と部屋が出る（場所の座標は出ない）', () => {
    for (const kind of ['admin', 'vitals', 'cameras'] as const) {
      const device = devices[kind] as { name: string; room: string; x: number; y: number };
      expect(isWalkable(map, device.x, device.y), kind).toBe(true);
      expect(areaAt(map, centerOf(device)), kind).toBe(device.room);
    }
    const { w } = setup();
    const obs = buildRoamObservation(w, w.roster[0] as string);
    expect(obs.devices).toEqual([
      { kind: 'admin', name: 'シフト表', room: '帳場' },
      { kind: 'vitals', name: 'ずんだ餅ボード', room: '休憩室' },
      { kind: 'cameras', name: '防犯カメラの画面', room: '機械室' },
    ]);
    expect(obs.cameraView).toBeNull();
  });

  it('シフト表: 部屋ごとの人数が分かる。誰なのかは出ない', () => {
    const { w, put, runUntilIdle, name } = setup();
    const [looker, loner] = w.roster as [string, string];
    put(loner, ice);
    applyRoamIntent(w, looker, { action: 'check', target: 'シフト表' });
    runUntilIdle(looker);
    const reading = buildRoamObservation(w, looker).lastResult ?? '';
    expect(reading).toContain('「シフト表」を見た');
    expect(reading).toContain('氷室 1人');
    expect(reading).toContain('帳場 1人');
    expect(reading).toContain('中庭 4人');
    expect(reading).not.toContain(name(loner));
    const end = w.happenings.find((h) => h.type === 'look' && h.phase === 'end');
    expect(end).toMatchObject({ id: looker, device: 'admin', counts: { 氷室: 1, 帳場: 1, 中庭: 4 } });
  });

  it('ずんだ餅ボード: ずんだ餅になった人が分かる', () => {
    const { w, runUntilIdle, name } = setup();
    const [looker, mochi] = w.roster as [string, string];
    playerById(w, mochi).status = 'asleep';
    applyRoamIntent(w, looker, { action: 'check', target: 'ずんだ餅ボード' });
    runUntilIdle(looker);
    expect(buildRoamObservation(w, looker).lastResult).toContain(`ずんだ餅になっている: ${name(mochi)}`);
  });

  it('防犯カメラ: 見ている間は廊下が映り、映った人からは赤いランプが見える。見終わると、映った人が本人に伝わる', () => {
    const { w, put, watching, runUntilIdle, name } = setup();
    const [looker, walker, ...rest] = w.roster as [string, string, ...string[]];
    for (const id of rest) put(id, ice);
    put(looker, devices.cameras as Point);
    put(walker, { x: 41, y: 10 });
    expect(buildRoamObservation(w, walker).cameraLit).toEqual([]);
    applyRoamIntent(w, looker, { action: 'check', target: '防犯カメラの画面' });
    stepRoam(w);
    expect(watching(looker)).toBe(true);
    const view = buildRoamObservation(w, looker).cameraView ?? [];
    expect(view.find((v) => v.place === '北の廊下')?.seen).toEqual([{ name: name(walker), asleep: false }]);
    expect(buildRoamObservation(w, walker).cameraLit).toEqual(['北の廊下']);
    // 氷室の人は、廊下のカメラが見えないので、ランプにも気づかない
    expect(buildRoamObservation(w, rest[0] as string).cameraLit).toEqual([]);
    runUntilIdle(looker);
    expect(buildRoamObservation(w, looker).lastResult).toContain(`北の廊下のカメラ: ${name(walker)}`);
    expect(buildRoamObservation(w, walker).cameraLit).toEqual([]);
  });

  it('防犯カメラの画面で見られている間は、「見られていない時だけ変える」は待つ', () => {
    const { w, put, watching } = setup();
    const nibbler = w.actors.find((a) => a.nibbler)?.id as string;
    const artisans = w.actors.filter((a) => !a.nibbler && !a.madman && !a.fox).map((a) => a.id);
    const [looker, target] = artisans as [string, string];
    for (const id of w.roster) if (id !== nibbler && id !== looker && id !== target) put(id, ice);
    put(looker, devices.cameras as Point);
    put(nibbler, { x: 40, y: 10 });
    put(target, { x: 41, y: 10 });
    w.napReadyAt[nibbler] = 0;
    applyRoamIntent(w, looker, { action: 'check', target: '防犯カメラの画面' });
    applyRoamIntent(w, nibbler, { action: 'transform_if_unseen', target: nameOf(w, target) });
    let n = 0;
    stepRoam(w);
    while (n < 4000 && watching(looker)) {
      // 画面を見ている刻みのあいだは、変えない（見終わった刻みには変わってよい）
      expect(playerById(w, target).status).toBe('awake');
      stepRoam(w);
      n++;
    }
    expect(n).toBeGreaterThan(10);
    // 画面から離れたら、変えられる
    for (let k = 0; k < 40 && playerById(w, target).status === 'awake'; k++) stepRoam(w);
    expect(playerById(w, target).status).toBe('asleep');
  });

  it('知らない道具の名前は、決まり違反になる', () => {
    const { w } = setup();
    expect(() => applyRoamIntent(w, w.roster[0] as string, { action: 'check', target: '金庫' })).toThrow(/unknown_device|道具/);
  });
});
