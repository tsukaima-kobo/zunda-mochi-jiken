import { readFileSync } from 'node:fs';
import path from 'node:path';
import { limitCalls, QuotaExhaustedError } from '../../agents/src/index.ts';
import type { Brain, BrainRequest } from '../../agents/src/index.ts';
import type { MapDefinition, RoamWorld } from '../../sim/src/index.ts';
import { describe, expect, it } from 'vitest';
import { runMatch } from '../src/index.ts';
import type { MatchLog } from '../src/index.ts';

const map = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../content/maps/workshop-small.json'), 'utf8')) as MapDefinition;
const fixedClock = () => new Date('2026-11-16T00:00:00Z');
const base = { map, denyList: [], now: fixedClock } as const;

/**
 * 受け取った要求を全部覚えておき、プロンプトとスキーマだけを見て試合を進める頭脳。
 * 妖精なら見えている相手をずんだ餅に変え、ずんだ餅になった人が見えたら知らせ、ほかは部屋を回る。
 */
class PlayingBrain implements Brain {
  readonly id: string;
  readonly requests: BrainRequest[] = [];
  private readonly failAt: number | null;
  constructor(id: string, failAt: number | null = null) {
    this.id = id;
    this.failAt = failAt;
  }
  async decide(request: BrainRequest) {
    this.requests.push(request);
    if (this.failAt !== null && this.requests.length >= this.failAt) throw new QuotaExhaustedError(this.id);
    const props = (request.schema as { properties: Record<string, { enum?: string[] }> }).properties;
    const n = this.requests.length;
    let json: unknown;
    if (props.action) {
      const seen = [...(/【見えている相手】(.*)/.exec(request.user)?.[1] ?? '').matchAll(/([^、（]+)（([^）]*)）/g)].map((m) => ({ name: m[1] as string, asleep: (m[2] as string).includes('ずんだ餅になっている') }));
      const sleeper = seen.find((v) => v.asleep);
      const awake = seen.find((v) => !v.asleep);
      if (props.action.enum?.includes('transform_if_unseen') && awake) json = { thought: '考え', action: 'transform_if_unseen', target: awake.name };
      else if (sleeper) json = { thought: '考え', action: 'report', target: sleeper.name };
      else json = { thought: '考え', action: 'move_to', target: props.target!.enum![n % 4] }; // 先頭の4つは部屋
    } else if (props.vote) {
      json = { thought: '考え', vote: props.vote.enum![n % props.vote.enum!.length], memo: `覚え書き${n}` };
    } else {
      json = { thought: '考え', say: '見たことを話すね。', suspect: props.suspect!.enum![0] };
    }
    return { json, usage: null, latencyMs: 0, problems: [] };
  }
  bytes(): string {
    return this.requests.map((r) => `${r.system}\n${r.user}\n${JSON.stringify(r.schema)}`).join('\n');
  }
}

const count = (log: MatchLog, type: string) => log.events.filter((e) => e.type === type).length;

describe('試合（見回りと集会）', () => {
  it('台本ボットだけで最後まで進み、同じ種なら同じ試合になる', async () => {
    const first = await runMatch({ ...base, seed: 4, brains: [null] });
    expect(first).toMatchObject({ version: 2, mode: 'match', status: 'finished', outcome: null });
    expect(first.result).not.toBeNull();
    expect(first.events[0]).toEqual({ type: 'round_start', t: 0, round: 1 });
    expect(first.events.at(-1)).toMatchObject({ type: 'game_over', winner: first.result!.winner });
    const frames = first.roam!.frames;
    expect(frames[0]).toMatchObject({ r: 1, t: 0, st: 'aaaaa' });
    expect(frames[0]!.pos).toHaveLength(10);
    expect(frames.at(-1)!.t).toBe(first.result!.clock);
    expect(await runMatch({ ...base, seed: 4, brains: [null] })).toEqual(first);
  });

  it('意図は、決めた時刻から「反応の遅れ」のあとに適用される', async () => {
    const log = await runMatch({ ...base, seed: 2, brains: [null], reactionSeconds: 1, roam: { roamSeconds: 20 } });
    const firstDecisions = log.events.filter((e) => e.type === 'decide').slice(0, 5);
    expect(firstDecisions.map((e) => e.type === 'decide' && e.t)).toEqual([1, 1, 1, 1, 1]);
  });

  it('1000試合を回しても止まらず、記録に矛盾がなく、どちらの陣営も勝つことがある', async () => {
    const wins = { artisan: 0, nibbler: 0, fox: 0 };
    const whys = new Set<string>();
    for (let seed = 1; seed <= 1000; seed++) {
      const players = 5 + (seed % 2);
      const log = await runMatch({ ...base, seed, players, brains: [null] });
      const label = `seed ${seed}`;
      expect(log.status, label).toBe('finished');
      const result = log.result!;
      wins[result.winner] += 1;
      whys.add(result.why);
      expect(count(log, 'game_over'), label).toBe(1);
      expect(log.events.at(-1)!.type, label).toBe('game_over');

      const nibbler = log.players.find((p) => p.role === 'nibbler')!.name;
      const gone = new Set<string>(); // 餅になった人と、クビになった人
      let attendees: string[] = [];
      let votes = 0;
      let roundStart = 0;
      let lastNap = -Infinity;
      for (const event of log.events) {
        if (event.type === 'round_start') {
          roundStart = event.t;
        } else if (event.type === 'decide') {
          expect(gone.has(event.agent), `${label}: いない人が動いた`).toBe(false);
        } else if (event.type === 'nap') {
          expect(event.by, label).toBe(nibbler);
          expect(gone.has(event.target), `${label}: 同じ人が2回餅になった`).toBe(false);
          // 渡せるまでの待ち時間を守っている（見回りの初めからも、前に渡してからも）
          expect(event.t - Math.max(roundStart, lastNap), label).toBeGreaterThanOrEqual(log.roam!.config.napCooldown - 1e-6);
          lastNap = event.t;
          gone.add(event.target);
        } else if (event.type === 'meeting_start') {
          attendees = event.attendees;
          votes = 0;
          expect(attendees.filter((name) => gone.has(name)), `${label}: いない人が出席した`).toEqual([]);
          expect([...attendees, ...event.absent.map((a) => a.name)].sort(), label).toEqual([...log.seats].sort());
          expect(attendees, label).toContain(event.reporter);
        } else if (event.type === 'speak') {
          expect(attendees, label).toContain(event.speaker);
          expect([...event.say].length, label).toBeLessThanOrEqual(log.config.sayMaxChars);
        } else if (event.type === 'vote') {
          votes += 1;
          expect(attendees, label).toContain(event.voter);
        } else if (event.type === 'meeting_end') {
          expect(votes, label).toBe(attendees.length);
          if (event.ejected) gone.add(event.ejected);
        }
      }

      // 勝敗の理由が、記録と合っている
      const awakeArtisans = log.players.filter((p) => p.role === 'artisan' && !gone.has(p.name)).length;
      if (result.why === 'nibbler_sent_home') expect(gone.has(nibbler), label).toBe(true);
      else expect(gone.has(nibbler), label).toBe(false);
      if (result.why === 'outnumbered') expect(awakeArtisans, label).toBeLessThanOrEqual(1);
      else expect(awakeArtisans, label).toBeGreaterThan(1);
      if (result.why === 'opened') expect(result.clock, label).toBe(log.roam!.config.roamSeconds);
      else expect(result.clock, label).toBeLessThanOrEqual(log.roam!.config.roamSeconds); // 最後の刻みに餅に変えて決まることもある
      // 最後のコマの状態も同じ
      const last = log.roam!.frames.at(-1)!;
      log.seats.forEach((name, i) => expect(last.st[i] === 'a', `${label}: ${name}`).toBe(!gone.has(name)));
    }
    expect(wins.artisan).toBeGreaterThan(100);
    expect(wins.nibbler).toBeGreaterThan(100);
    // どちらの陣営も勝つ（開店まで守りきる勝ち方は、小さいマップの台本ボットでは、まれにしか起きない）
    expect(whys.has('nibbler_sent_home') && whys.has('outnumbered')).toBe(true);
    for (const why of whys) expect(['nibbler_sent_home', 'opened', 'outnumbered', 'tasks_done', 'crisis', 'late']).toContain(why);
  }, 120_000);

  for (const seed of [1, 2, 3, 7, 12]) {
    it(`seed ${seed}: 見回りでも集会でも、他人の秘密は頭脳に渡らない`, async () => {
      let world!: RoamWorld;
      const brains = [0, 1, 2, 3, 4].map((i) => new PlayingBrain(`seat-${i}`));
      const log = await runMatch({
        ...base,
        seed,
        brains,
        roam: { napCooldown: 5 },
        prepareWorld: (w) => {
          world = w;
          w.players.forEach((player, index) => {
            player.persona += `CANARY-${index}-PERSONA`;
            player.style += `CANARY-${index}-STYLE`;
          });
        },
      });
      expect(log.status).toBe('finished');
      // 守るべき秘密がある試合になっている（餅に変えられた人と集会がある）
      expect(count(log, 'nap')).toBeGreaterThan(0);
      expect(count(log, 'meeting_start')).toBeGreaterThan(0);
      world.roster.forEach((id, seat) => {
        const me = world.players.findIndex((p) => p.id === id);
        const brain = brains[seat]!;
        const bytes = brain.bytes();
        expect(brain.requests.length).toBeGreaterThan(0); // 早々に餅にされた人は、数回しか聞かれない
        expect(bytes).toContain(`CANARY-${me}-PERSONA`);
        for (const [other] of world.players.entries()) {
          if (other !== me) expect(bytes).not.toContain(`CANARY-${other}-`);
        }
        if (world.players[me]!.role === 'artisan') {
          expect(bytes).not.toContain('あなたはずんだの妖精です');
          // 妖精だけの行動と状態は、従業員に渡る文字列のどこにも出ない
          expect(bytes).not.toMatch(/transform|nap|【ずんだ餅に変える力】|ずんだ餅に変えた/);
        }
        // 座標や内部の番号は、どの頭脳にも渡らない
        expect(bytes).not.toMatch(/"pos"|"path"|\bp[1-8]\b/);
        // 覚え書きは、書いた本人にしか戻らない
        const memos = [...bytes.matchAll(/覚え書き: (覚え書き\d+)/g)].map((m) => m[1]);
        const own = new Set(log.events.flatMap((e) => (e.type === 'vote' && e.voter === world.players[me]!.name ? [e.memo] : [])));
        for (const memo of memos) expect(own.has(memo as string)).toBe(true);
      });
    });
  }

  it('観測できない違い（他人の口調）は、本人が聞かれる時刻も内容も変えない', async () => {
    const requestsOfSeat0 = async (hidden: string) => {
      const brain = new PlayingBrain('seat-0');
      const ticks: number[] = [];
      const original = brain.decide.bind(brain);
      let world!: RoamWorld;
      brain.decide = (request) => {
        ticks.push(world.tick);
        return original(request);
      };
      await runMatch({
        ...base,
        seed: 6,
        brains: [brain, null, null, null, null],
        prepareWorld: (w) => {
          world = w;
          for (const p of w.players) if (p.id !== w.roster[0]) {
            p.persona = hidden;
            p.style = hidden;
          }
        },
      });
      return { ticks, users: brain.requests.map((r) => r.user), schemas: brain.requests.map((r) => r.schema) };
    };
    const a = await requestsOfSeat0('のんびり');
    const b = await requestsOfSeat0('まったく別の、長い長い口調の説明');
    expect(a.ticks.length).toBeGreaterThan(3);
    expect(b).toEqual(a);
  });

  it('開店までに適用できない判断は、頭脳に聞かない', async () => {
    // 餅に変える人がいない（待ち時間が開店より長い）ので、集会は起きず、聞いた判断はすべて適用される
    const brains = [0, 1, 2, 3, 4].map((i) => new PlayingBrain(`seat-${i}`));
    for (const roamSeconds of [20, 23, 45]) {
      const before = brains.reduce((sum, b) => sum + b.requests.length, 0);
      const log = await runMatch({ ...base, seed: 5, brains, roam: { roamSeconds, napCooldown: 999 } });
      const asked = brains.reduce((sum, b) => sum + b.requests.length, 0) - before;
      expect(log.result).toMatchObject({ winner: 'artisan', why: 'opened' });
      expect(count(log, 'decide')).toBeGreaterThan(8);
      expect(asked, `roamSeconds=${roamSeconds}`).toBe(count(log, 'decide'));
    }
  });

  it('1試合の呼び出しの上限に達したら、代用せずに止めて記録を残す（上限は全員で共有）', async () => {
    const brains = [0, 1, 2, 3, 4].map((i) => new PlayingBrain(`seat-${i}`));
    const log = await runMatch({ ...base, seed: 1, brains: limitCalls(brains, 12) });
    expect(log).toMatchObject({ status: 'stopped_limit', result: null });
    expect(brains.reduce((sum, b) => sum + b.requests.length, 0)).toBe(12);
    expect(log.stats.sources.fallback).toBe(0);
    // 台本ボットは数えない
    const scripted = await runMatch({ ...base, seed: 1, brains: limitCalls([null], 0) });
    expect(scripted.status).toBe('finished');
  });

  it('見回りの途中でも、集会の途中でも、利用枠が尽きたら止めて記録を残す', async () => {
    const early = await runMatch({ ...base, seed: 1, brains: [new PlayingBrain('quota', 6)] });
    expect(early).toMatchObject({ status: 'stopped_quota', result: null });
    expect(early.roam!.frames.length).toBeGreaterThan(1);
    expect(count(early, 'game_over')).toBe(0);
    expect(early.stats.sources.fallback).toBe(0);

    // 集会の最中に尽きる場合: 最初の集会が始まってから数回目の呼び出しで止める
    const probe = await runMatch({ ...base, seed: 1, brains: [new PlayingBrain('probe')], roam: { napCooldown: 5 } });
    const startIndex = probe.events.findIndex((e) => e.type === 'meeting_start');
    expect(startIndex).toBeGreaterThan(0);
    const callsBefore = probe.events.slice(0, startIndex).filter((e) => e.type === 'decide').length;
    const late = await runMatch({ ...base, seed: 1, brains: [new PlayingBrain('quota', callsBefore + 8)], roam: { napCooldown: 5 } });
    expect(late).toMatchObject({ status: 'stopped_quota', result: null });
    expect(count(late, 'meeting_start')).toBe(1);
    expect(count(late, 'meeting_end')).toBe(0);
  });
});
