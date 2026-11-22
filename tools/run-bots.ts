// 台本ボットだけの試合を、画面なしで回す。
//   npm run bots -- --seed 7 --players 11 --out matches/seed-7.json
// --out を付けると、試合の記録（JSON）を書き出す。
// 狐・占い師・妖精マニアは、9人以上なら1人ずつ入る（--foxes 0 --seers 0 --madmen 0 で、妖精と従業員だけ）。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { describeOutcome, runMatch } from '../packages/server/src/index.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    players: { type: 'string', default: '11' },
    foxes: { type: 'string' },
    seers: { type: 'string' },
    madmen: { type: 'string' },
    map: { type: 'string', default: 'workshop' },
    out: { type: 'string' },
  },
});

const here = path.dirname(new URL(import.meta.url).pathname);
const map = JSON.parse(readFileSync(path.resolve(here, `../content/maps/${values.map}.json`), 'utf8'));
const players = Number(values.players);
const count = (value: string | undefined) => (value === undefined ? (players >= 9 ? 1 : 0) : Number(value));
const log = await runMatch({
  seed: Number(values.seed),
  map,
  players,
  roam: { foxes: count(values.foxes), seers: count(values.seers), madmen: count(values.madmen) },
  brains: [null],
  denyList: [],
});

const ROLE: Record<string, string> = { artisan: '従業員', nibbler: 'ずんだの妖精', madman: '妖精マニア', fox: '狐', seer: '占い師' };
console.log(`種 ${values.seed} ／ ${log.seats.length}人`);
for (const player of log.players) console.log(`  ${player.name}: ${ROLE[player.role] ?? player.role}`);
console.log(describeOutcome(log));
if (values.out) {
  mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(log)}\n`);
  console.log(`記録: ${values.out}`);
}
