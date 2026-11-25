// 終盤の人数の読み（endgame.ts）の検算。人数だけの小さなゲームを全探索して、AI に渡す式（endgameOutlook）と食い違わないことを確かめる。
// 前提と限界は endgame.ts の冒頭に書いてある。

import { describe, expect, it } from 'vitest';
import { blindChances, crewCanWinAtMeeting, endgameOutlook, endOf, meetingOutcomes, patrolOutcome } from '../src/endgame.ts';
import type { EndCount, NapsPerPatrol } from '../src/endgame.ts';

const count = (crew: number, madmen: number, fox: number, wolves: number): EndCount => ({ crew, madmen, fox, wolves });

/** 全探索で、集会の始まりの局面を3つに分ける: lost = 勝てる選び方が無い / last = スキップでは勝てないが、選べば勝てる / free = スキップしても勝てる。 */
function classify(c: EndCount, naps: NapsPerPatrol): 'lost' | 'last' | 'free' {
  const o = meetingOutcomes(c, naps);
  if (!Object.values(o).includes('crew')) return 'lost';
  return o.skip === 'crew' ? 'free' : 'last';
}

describe('試合の終わり方（roam.ts の decideWinner と finish）', () => {
  it('人狼が0なら従業員の勝ち。ただし妖狐が起きていれば、妖狐の勝ち（横取り）', () => {
    expect(endOf(count(3, 0, 0, 0))).toBe('crew');
    expect(endOf(count(3, 0, 1, 0))).toBe('fox');
  });

  it('起きている人間（従業員・狂信者・妖狐）が人狼と同数以下なら人狼の勝ち。ただし妖狐が起きていれば、妖狐の勝ち', () => {
    expect(endOf(count(1, 0, 0, 1))).toBe('wolf');
    expect(endOf(count(1, 1, 0, 2))).toBe('wolf');
    expect(endOf(count(1, 0, 1, 2))).toBe('fox');
    expect(endOf(count(2, 0, 0, 1))).toBeNull();
    expect(endOf(count(1, 0, 1, 1))).toBeNull(); // 従業員1・妖狐1・人狼1: 人間は2人で、人狼より多い
    expect(endOf(count(0, 0, 1, 1))).toBe('fox'); // 妖狐だけが残った: 人間1人 ≤ 人狼1人 → 妖狐の勝ち
  });
});

describe('人数の読み（式）と全探索が合う', () => {
  it('見回りで人狼全体が1人ずつ餅にする時（人狼1〜3人・妖狐0/1・狂信者0/1・従業員1〜10人）', () => {
    for (let wolves = 1; wolves <= 3; wolves++)
      for (const fox of [0, 1])
        for (const madmen of [0, 1])
          for (let crew = 1; crew <= 10; crew++) {
            const c = count(crew, madmen, fox, wolves);
            if (endOf(c)) continue;
            const awake = crew + madmen + fox + wolves;
            const outlook = endgameOutlook(awake, wolves, fox === 1, 'one');
            expect(outlook.meeting, JSON.stringify(c)).toBe(classify(c, 'one'));
            expect(outlook.patrolLost, JSON.stringify(c)).toBe(patrolOutcome(c, 'one') !== 'crew');
          }
  });

  it('人狼1人ずつが餅にする時（人狼1〜2人。人狼が増えると、余裕が人狼の数−1だけ減る）', () => {
    for (let wolves = 1; wolves <= 2; wolves++)
      for (const fox of [0, 1])
        for (const madmen of [0, 1])
          for (let crew = 1; crew <= 10; crew++) {
            const c = count(crew, madmen, fox, wolves);
            if (endOf(c)) continue;
            const awake = crew + madmen + fox + wolves;
            const outlook = endgameOutlook(awake, wolves, fox === 1, 'each');
            expect(outlook.meeting, JSON.stringify(c)).toBe(classify(c, 'each'));
            expect(outlook.patrolLost, JSON.stringify(c)).toBe(patrolOutcome(c, 'each') !== 'crew');
          }
  });

  it('余裕（スキップできる回数）は、起きている人数が「最後の局面」の人数を上回った分', () => {
    expect(endgameOutlook(5, 1, true).skips).toBe(0);
    expect(endgameOutlook(6, 1, true).skips).toBe(1);
    expect(endgameOutlook(8, 1, true).skips).toBe(3);
    expect(endgameOutlook(3, 1, false).skips).toBe(0);
    expect(endgameOutlook(4, 1, false).skips).toBe(1);
  });
});

describe('勝ちパターン（人数だけの読み。見回りで1人ずつ餅にされる時）', () => {
  it('人狼1・妖狐1・従業員3（5人）: 妖狐をクビにする道だけが勝ち。スキップも、人狼をクビにすることも、従業員を間違ってクビにすることも負け', () => {
    const o = meetingOutcomes(count(3, 0, 1, 1), 'one');
    expect(o.fox).toBe('crew');
    expect(o.skip).not.toBe('crew');
    expect(o.wolf).toBe('fox'); // 最後の人狼をクビにすると、妖狐に横取りされる
    expect(o.crew).not.toBe('crew');
  });

  it('人狼1・妖狐1・従業員4（6人）: スキップなら勝ち目が残る。従業員を間違ってクビにしても、最後の人狼をクビにしても、負け', () => {
    const o = meetingOutcomes(count(4, 0, 1, 1), 'one');
    expect(o.skip).toBe('crew');
    expect(o.fox).toBe('crew');
    expect(o.crew).not.toBe('crew');
    expect(o.wolf).toBe('fox');
  });

  it('人狼1・妖狐1・従業員2（4人）や、従業員1（3人）: 完全な情報があっても、もう勝てない（妖狐をクビにすると人狼の勝ち・それ以外は妖狐の勝ち）', () => {
    for (const crew of [1, 2]) {
      const c = count(crew, 0, 1, 1);
      expect(crewCanWinAtMeeting(c, 'one')).toBe(false);
      const o = meetingOutcomes(c, 'one');
      expect(o.fox).toBe('wolf');
      expect(o.skip).toBe('fox');
    }
  });

  it('人狼1・妖狐なし・従業員2（3人）: 人狼をクビにできれば勝ち。スキップなら、次の見回りで人狼の勝ち', () => {
    const o = meetingOutcomes(count(2, 0, 0, 1), 'one');
    expect(o.wolf).toBe('crew');
    expect(o.skip).toBe('wolf');
    // 見回りの始まりがこの人数なら、集会の前に1人餅になって、もう勝てない
    expect(patrolOutcome(count(2, 0, 0, 1), 'one')).toBe('wolf');
  });

  it('人狼2・妖狐1・従業員4（7人）: 人狼を先にクビにしても、妖狐を先にクビにしても勝てる。スキップは負け', () => {
    const o = meetingOutcomes(count(4, 0, 1, 2), 'one');
    expect(o.wolf).toBe('crew');
    expect(o.fox).toBe('crew');
    expect(o.skip).not.toBe('crew');
  });

  it('人狼2・妖狐1（見回りで2人が餅になる時）: 従業員4人（7人）は、人狼をクビにする道だけが残る', () => {
    const o = meetingOutcomes(count(4, 0, 1, 2), 'each');
    expect(o.wolf).toBe('crew');
    expect(o.fox).not.toBe('crew');
  });

  it('11人（人狼2・狂信者1・妖狐1・従業員7）の最初の集会は、余裕がたっぷりある', () => {
    const c = count(7, 1, 1, 2);
    expect(classify(c, 'one')).toBe('free');
    expect(endgameOutlook(11, 2, true, 'each').skips).toBe(3);
  });
});

describe('手がかりが全く無い時の、当てずっぽうの投票とスキップ（従業員の勝つ確率）', () => {
  it('人狼1・妖狐1・従業員3（5人。余裕0）: スキップなら勝ち目が無く、当てずっぽうなら 1/8', () => {
    const r = blindChances(3, 1, 1);
    expect(r.skip).toBe(0);
    expect(r.vote).toBeCloseTo(1 / 8, 10);
  });

  it('人狼1・妖狐1: 従業員が奇数（起きている人が奇数）なら、当てずっぽうがスキップより良い。偶数は僅差でスキップ（差は 0.03 以内）', () => {
    for (const crew of [3, 5, 7, 9]) {
      const r = blindChances(crew, 1, 1);
      expect(r.vote, `従業員${crew}`).toBeGreaterThan(r.skip);
    }
    for (const crew of [4, 6, 8]) {
      const r = blindChances(crew, 1, 1);
      expect(r.skip - r.vote, `従業員${crew}`).toBeGreaterThanOrEqual(0);
      expect(r.skip - r.vote, `従業員${crew}`).toBeLessThan(0.03);
    }
  });

  it('人狼2・妖狐1（見回りで2人餅になる時）: 当てずっぽうが、スキップより良い（従業員8人は僅差でスキップ）', () => {
    for (const crew of [4, 5, 6, 7, 9]) {
      const r = blindChances(crew, 1, 2, 'each');
      expect(r.vote, `従業員${crew}`).toBeGreaterThan(r.skip);
    }
  });

  it('妖狐がいなければ、人狼を当てればその場で勝ち。従業員2人（3人）は入れるしかない', () => {
    const r = blindChances(2, 0, 1);
    expect(r.vote).toBeCloseTo(0.5, 10);
    expect(r.skip).toBe(0);
  });
});

