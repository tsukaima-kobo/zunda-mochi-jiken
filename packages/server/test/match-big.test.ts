// 広い工房・11人（人狼2人・妖狐1人）の試合（仕込み、鐘、妨害、抜け道、心だけの仕込み）。

import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Brain, BrainRequest } from '../../agents/src/index.ts';
import type { MapDefinition, RoamWorld } from '../../sim/src/index.ts';
import { describe, expect, it } from 'vitest';
import { runMatch } from '../src/index.ts';
import type { MatchLog } from '../src/index.ts';

const map = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../content/maps/workshop.json'), 'utf8')) as MapDefinition;
const fixedClock = () => new Date('2026-11-17T00:00:00Z');
const base = { map, players: 11, denyList: [], now: fixedClock } as const;
const count = (log: MatchLog, type: string) => log.events.filter((e) => e.type === type).length;

/**
 * プロンプトとスキーマだけを見て試合を進める頭脳。受け取った要求は全部覚えておく。
 * 従業員と狂信者は仕込みを進め、困りごとは直しに行き、ずんだ餅になった人を見たら知らせる。
 * 人狼（スキーマに専用の行動がある）は、見えている相手をずんだ餅に変え、ときどき妨害し、抜け道を使う。
 */
class BusyBrain implements Brain {
  readonly id: string;
  readonly requests: BrainRequest[] = [];
  constructor(id: string) {
    this.id = id;
  }
  async decide(request: BrainRequest) {
    this.requests.push(request);
    const props = (request.schema as { properties: Record<string, { enum?: string[] }> }).properties;
    const n = this.requests.length;
    const act = (action: string, target = 'なし') => ({ thought: '考え', action, target });
    let json: unknown;
    if (props.action) {
      const actions = props.action.enum ?? [];
      const allies = (/【仲間の人狼】(.*)/.exec(request.user)?.[1] ?? '').split('、');
      const seen = [...(/【見えている相手】(.*)/.exec(request.user)?.[1] ?? '').matchAll(/([^、（]+)（([^）]*)）/g)].map((m) => ({ name: m[1] as string, asleep: (m[2] as string).includes('ずんだ餅になっている') }));
      const sleeper = seen.find((v) => v.asleep);
      const awake = seen.find((v) => !v.asleep && !allies.includes(v.name));
      if (actions.includes('transform_if_unseen') && awake && request.user.includes('【ずんだ餅に変える力】いま使える')) json = act('transform_if_unseen', awake.name);
      else if (sleeper && !actions.includes('sneak')) json = act('report', sleeper.name);
      else if (actions.includes('sabotage') && n % 5 === 0) json = act('sabotage', n % 2 === 0 ? 'あかり' : 'かまど');
      else if (actions.includes('sabotage') && n % 7 === 0) json = act('sabotage', '氷室');
      else if (actions.includes('sneak') && n % 4 === 0) json = act('sneak', ['氷室', '蒸し場', '店先', '休憩室'][n % 3] as string);
      else if (request.user.includes('【困りごと】')) json = act('fix');
      else json = act('do_task');
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

describe('広い工房・11人の試合', () => {
  it('台本ボットだけで最後まで進み、同じ種なら同じ試合になる', async () => {
    const first = await runMatch({ ...base, seed: 3, brains: [null] });
    expect(first).toMatchObject({ mode: 'match', status: 'finished' });
    expect(first.players.filter((p) => p.role === 'nibbler')).toHaveLength(2);
    expect(first.truth.nibbler?.split('、')).toHaveLength(2);
    // 2026-11-18 から、狂信者の代わりに妖狐が1人
    expect(first.players.filter((p) => p.role === 'madman')).toHaveLength(0);
    expect(first.players.filter((p) => p.role === 'fox')).toHaveLength(1);
    expect(first.truth.fox?.split('、')).toHaveLength(1);
    expect(first.roam!.frames[0]).toMatchObject({ r: 1, t: 0, st: 'aaaaaaaaaaa' });
    expect(first.roam!.taskTotal).toBeGreaterThan(60);
    expect(await runMatch({ ...base, seed: 3, brains: [null] })).toEqual(first);
  });

  it('150試合を回しても止まらず、記録に矛盾がなく、いろいろな終わり方をする', async () => {
    const wins = { artisan: 0, nibbler: 0, fox: 0 };
    const whys = new Set<string>();
    const kinds = new Set<string>();
    for (let seed = 1; seed <= 150; seed++) {
      const log = await runMatch({ ...base, seed, brains: [null] });
      const label = `seed ${seed}`;
      expect(log.status, label).toBe('finished');
      const result = log.result!;
      wins[result.winner] += 1;
      whys.add(result.why);
      expect(log.events.at(-1)!.type, label).toBe('game_over');

      const nibblers = new Set(log.players.filter((p) => p.role === 'nibbler').map((p) => p.name));
      const madmen = new Set(log.players.filter((p) => p.role === 'madman').map((p) => p.name));
      const foxes = new Set(log.players.filter((p) => p.role === 'fox').map((p) => p.name));
      const asleep = new Set<string>();
      const home = new Set<string>();
      const under = new Set<string>();
      let done = 0;
      let total = log.roam!.taskTotal;
      let trouble: { what: string; t: number } | null = null;
      let rang: string | null = null;
      for (const event of log.events) {
        kinds.add(event.type === 'sabotage' ? `sabotage:${event.what}` : event.type);
        if (event.type === 'decide') {
          expect(asleep.has(event.agent) || home.has(event.agent), `${label}: いない人が動いた`).toBe(false);
        } else if (event.type === 'nap') {
          expect(nibblers.has(event.by), label).toBe(true);
          expect(nibblers.has(event.target), `${label}: 仲間を餅に変えた`).toBe(false);
          asleep.add(event.target);
        } else if (event.type === 'task') {
          expect(home.has(event.agent), `${label}: クビになった人が仕込みをした`).toBe(false);
          expect(event.pretend, label).toBe(nibblers.has(event.agent) || madmen.has(event.agent) || foxes.has(event.agent));
          expect(event.spirit, `${label}: ${event.agent}`).toBe(asleep.has(event.agent));
          if (!event.pretend) {
            done += 1;
            expect(event.done, label).toBe(done);
            expect(event.total, label).toBeLessThanOrEqual(total);
            total = event.total;
          }
        } else if (event.type === 'sabotage') {
          expect(nibblers.has(event.by), label).toBe(true);
          if (event.what !== 'door') {
            expect(trouble, `${label}: 困りごとの最中に、次の妨害をした`).toBeNull();
            trouble = { what: event.what, t: event.t };
          }
        } else if (event.type === 'fixed') {
          expect(trouble?.what, label).toBe(event.what);
          expect(event.by.length, label).toBe(event.what === 'crisis' ? 2 : 1);
          trouble = null;
        } else if (event.type === 'sneak') {
          expect(nibblers.has(event.by), label).toBe(true);
          expect(under.has(event.by), label).toBe(event.phase === 'out');
          if (event.phase === 'in') under.add(event.by);
          else under.delete(event.by);
        } else if (event.type === 'bell') {
          rang = event.by;
        } else if (event.type === 'meeting_start') {
          expect(event.kind, label).toBe(rang ? 'bell' : 'report');
          if (rang) expect(event.reporter, label).toBe(rang);
          expect(event.found === null, label).toBe(event.kind === 'bell');
          expect(event.attendees.filter((name) => asleep.has(name) || home.has(name)), `${label}: いない人が出席した`).toEqual([]);
          rang = null;
          trouble = null;
          under.clear();
        } else if (event.type === 'meeting_end') {
          if (event.ejected) home.add(event.ejected);
        } else if (event.type === 'round_start' || event.type === 'game_over') {
          // クビになった人の残りの仕込みは、次の見回りの始め（か、試合の終わり）の数から減っている
          if (event.tasks) {
            expect(event.tasks.done, label).toBe(done);
            expect(event.tasks.total, label).toBeLessThanOrEqual(total);
            total = event.tasks.total;
          }
        }
      }

      // コマの記録: 状態の文字と、心だけの姿の位置
      for (const frame of log.roam!.frames) {
        expect(frame.st, label).toMatch(/^[awuzx]{11}$/);
        if (frame.gp) expect(frame.gp, label).toHaveLength(22);
      }
      const last = log.roam!.frames.at(-1)!;
      log.seats.forEach((name, i) => {
        expect('awu'.includes(last.st[i] as string), `${label}: ${name}`).toBe(!asleep.has(name) && !home.has(name));
        if ((last.gp?.[i * 2] ?? -1) >= 0) expect(asleep.has(name) && !nibblers.has(name) && !madmen.has(name) && !foxes.has(name), `${label}: ${name} の心だけの姿`).toBe(true);
      });

      // 勝敗の理由が、記録と合っている
      const awake = log.players.filter((p) => !asleep.has(p.name) && !home.has(p.name));
      const awakeNibblers = awake.filter((p) => p.role === 'nibbler').length;
      // 狂信者と妖狐は人間側に数える。妖狐が、自分の仕込みを決まった数だけ終えて起きたまま終われば、勝ちは妖狐（理由は、本来の終わり方のまま）。
      // 起きていても仕込みが足りなければ、横取りできない（foxMissed。2026-11-21 から）
      const foxAwake = awake.find((p) => p.role === 'fox');
      const foxDone = foxAwake ? log.events.filter((e) => e.type === 'task' && e.agent === foxAwake.name).length : 0;
      const foxNeed = log.roam!.config.foxSteps;
      expect(result.winner === 'fox', label).toBe(!!foxAwake && foxDone >= foxNeed);
      if (result.winner === 'fox') expect(result.stolenFrom, label).toBeDefined();
      if (foxAwake && foxDone < foxNeed) expect(result.foxMissed, label).toEqual({ done: foxDone, need: foxNeed });
      else expect(result.foxMissed, label).toBeUndefined();
      const awakeHumans = awake.length - awakeNibblers;
      expect(awakeNibblers === 0, label).toBe(result.why === 'nibbler_sent_home');
      if (result.why !== 'nibbler_sent_home') expect(awakeHumans <= awakeNibblers, label).toBe(result.why === 'outnumbered');
      if (result.why === 'tasks_done') expect(done, label).toBe(total);
      // 集会でクビになった従業員の残りが引かれて、人数で負けるのと同時に仕込みが数の上で終わることがある。人数の負けを先に見る
      else if (result.why !== 'outnumbered') expect(done, label).toBeLessThan(total);
      if (result.why === 'late') expect(result.clock, label).toBe(log.roam!.config.roamSeconds);
      if (result.why === 'crisis') expect(result.clock - (trouble?.t ?? Infinity), label).toBeCloseTo(log.roam!.config.crisisSeconds, 5);
      expect(result.why, label).not.toBe('opened');
    }
    // 妖狐には人狼の杖が効かない（2026-11-21 から）。台本ボットは妖狐を探さず、横取りに仕込みの条件も無い（2026-11-23 から）ので、妖狐の勝ちが多い（150試合で従業員12・人狼15・妖狐123）。
    expect(wins.artisan, JSON.stringify(wins)).toBeGreaterThan(5);
    expect(wins.nibbler, JSON.stringify(wins)).toBeGreaterThan(5);
    expect(wins.fox, JSON.stringify(wins)).toBeGreaterThan(5);
    for (const why of ['nibbler_sent_home', 'outnumbered', 'tasks_done']) expect([...whys]).toContain(why);
    for (const kind of ['task', 'sabotage:lights', 'sabotage:crisis', 'sabotage:door', 'fixed', 'door_open', 'sneak', 'nap', 'meeting_start']) expect([...kinds]).toContain(kind);
  }, 180_000);

  for (const seed of [2, 5, 9]) {
    it(`seed ${seed}: 従業員と妖狐に渡る文字列に、人狼だけの行動と状態は出ない。他人の秘密も役職も渡らない`, async () => {
      let world!: RoamWorld;
      const brains = Array.from({ length: 11 }, (_, i) => new BusyBrain(`seat-${i}`));
      const log = await runMatch({
        ...base,
        seed,
        brains,
        roam: { napCooldown: 8, sabotageFirstCooldown: 3, sabotageCooldown: 8, doorCooldown: 8 },
        prepareWorld: (w) => {
          world = w;
          w.players.forEach((player, index) => {
            player.persona += `CANARY-${index}-PERSONA`;
            player.style += `CANARY-${index}-STYLE`;
            player.bonds = [...(player.bonds ?? []), { name: 'だれか', level: 3, note: `CANARY-${index}-BOND` }];
          });
        },
      });
      expect(log.status).toBe('finished');
      // 守るべき秘密がある試合になっている
      for (const type of ['nap', 'meeting_start', 'sabotage', 'sneak', 'task']) expect(count(log, type), type).toBeGreaterThan(0);
      let artisans = 0;
      let foxes = 0;
      const foxNames = world.players.filter((p) => p.role === 'fox').map((p) => p.name);
      const fairyNames = world.players.filter((p) => p.role === 'nibbler').map((p) => p.name);
      world.roster.forEach((id, seat) => {
        const me = world.players.findIndex((p) => p.id === id);
        const brain = brains[seat]!;
        const bytes = brain.bytes();
        expect(brain.requests.length).toBeGreaterThan(0);
        expect(bytes).toContain(`CANARY-${me}-PERSONA`);
        expect(bytes).toContain(`CANARY-${me}-STYLE`);
        expect(bytes).toContain(`CANARY-${me}-BOND`);
        for (const [other] of world.players.entries()) {
          if (other !== me) expect(bytes).not.toContain(`CANARY-${other}-`);
        }
        const role = world.players[me]!.role;
        // クビになった人については、人狼だったかどうかしか伝わらない
        expect(bytes).not.toMatch(/（(従業員|狂信者|妖狐|人狼)でした）/);
        if (role !== 'nibbler') {
          expect(bytes).not.toContain('あなたは人狼です');
          expect(bytes).not.toMatch(/transform|nap|sneak|sabotage|【ずんだ餅に変える力】|【妨害】|【床下の抜け道】|【仲間の人狼】/);
          expect(bytes).not.toMatch(/ずんだ餅に変えた|変える機会がなかった|の戸を閉めた|あかりを消した|焚きすぎにした|抜け道を通って|閉められる部屋/);
        }
        if (role === 'artisan') {
          artisans += 1;
          expect(bytes).not.toMatch(/のふりをし|見せかけ|あなたは狂信者です|あなたは妖狐です/);
        } else if (role === 'fox') {
          foxes += 1;
          expect(bytes).toContain('あなたは妖狐です');
          // 横取りに仕込みの条件が無い試合（2026-11-23 から既定）では、妖狐の仕込みは見せかけ。条件の話は渡さない
          expect(bytes).toContain('【あなたの仕込み（ふりをするための見せかけ）】');
          expect(bytes).not.toContain('【妖狐の仕込みの進み】');
          expect(bytes).not.toContain('工程以上終えていれば');
        } else {
          expect(bytes).not.toContain('あなたは妖狐です');
          // 人狼も、誰が妖狐かを知らない（仲間の欄に出ない）
          for (const line of bytes.match(/【仲間の人狼】.*/g) ?? []) {
            for (const fox of foxNames) expect(line).not.toContain(fox);
            expect(fairyNames.some((fairy) => line.includes(fairy))).toBe(true);
          }
          expect(bytes).toContain('【妨害】');
          expect(bytes).toContain('【床下の抜け道】');
          expect(bytes).toContain('【あなたの仕込み（ふりをするための見せかけ）】');
        }
        // 座標や内部の名前は、どの頭脳にも渡らない
        expect(bytes).not.toMatch(/"pos"|"path"|\bp\d{1,2}\b|h-souko|iceblock/);
      });
      expect(artisans).toBe(8);
      expect(foxes).toBe(1);
    });
  }
});
