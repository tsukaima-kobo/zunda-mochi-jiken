// 台本ボットだけの試合を、画面なしで回す。
//   npm run bots -- --seed 7 --players 11 --out matches/seed-7.json
// --out を付けると、試合の記録（JSON）を書き出す。

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { describeOutcome, runMatch } from '../packages/server/src/index.ts';

const { values } = parseArgs({
  options: {
    seed: { type: 'string', default: '1' },
    players: { type: 'string', default: '11' },
    foxes: { type: 'string', default: '0' },
    map: { type: 'string', default: 'workshop' },
    out: { type: 'string' },
  },
});

const here = path.dirname(new URL(import.meta.url).pathname);
const map = JSON.parse(readFileSync(path.resolve(here, `../content/maps/${values.map}.json`), 'utf8'));
const log = await runMatch({
  seed: Number(values.seed),
  map,
  players: Number(values.players),
  roam: { foxes: Number(values.foxes) },
  brains: [null],
  denyList: [],
});

const ROLE: Record<string, string> = { artisan: '従業員', nibbler: 'ずんだの妖精', madman: '妖精びいき', fox: '狐' };
console.log(`種 ${values.seed} ／ ${log.seats.length}人`);
for (const player of log.players) console.log(`  ${player.name}: ${ROLE[player.role] ?? player.role}`);
console.log(describeOutcome(log));
if (values.out) {
  mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
  writeFileSync(values.out, `${JSON.stringify(log)}\n`);
  console.log(`記録: ${values.out}`);
}
