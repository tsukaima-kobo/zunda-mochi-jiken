// 最後の局面（ここで誰もクビにならないと、次に1人が餅になった時点で妖精の勝ち）では、従業員はスキップしない。

import type { MeetingObservation } from '../../protocol/src/index.ts';
import { describe, expect, it } from 'vitest';
import { checkIntent, feedbackFor, renderUser } from '../src/index.ts';

function voteObs(role: MeetingObservation['self']['role'], lastChance: boolean): MeetingObservation {
  return {
    kind: 'meeting',
    phase: 'vote',
    self: { name: 'もえぎ', role, persona: '口調', style: '', allies: [] },
    facts: [],
    history: [],
    cast: { total: 11, nibblers: 2, madmen: 1 },
    stakes: { awake: lastChance ? 3 : 7, fairiesLeft: 1, lastChance },
    meeting: { reason: '鐘', absent: [], round: 2, maxRounds: 2, attendees: ['もえぎ', 'あかね', 'つゆくさ'], transcript: [] },
    options: ['あかね', 'つゆくさ', 'スキップ'],
    limits: { sayTargetChars: 60, sayMaxChars: 80 },
  };
}

const vote = (choice: string) => ({ thought: 'うーん', vote: choice, memo: '', suspicion: [] });

describe('最後の局面', () => {
  it('従業員のスキップは、一度聞き直す。誰かに入れれば通る', () => {
    const obs = voteObs('artisan', true);
    const skip = checkIntent(obs, vote('スキップ'), []);
    expect(skip.ok).toBe(false);
    expect(skip.ok ? [] : skip.problems).toContain('last_chance_skip');
    expect(feedbackFor(skip.ok ? [] : skip.problems, obs)).toContain('いちばん怪しい人に入れて');
    expect(checkIntent(obs, vote('つゆくさ'), []).ok).toBe(true);
  });

  it('最後の局面でなければ、スキップしてよい。妖精と妖精マニアは、いつでもスキップしてよい', () => {
    expect(checkIntent(voteObs('artisan', false), vote('スキップ'), []).ok).toBe(true);
    expect(checkIntent(voteObs('nibbler', true), vote('スキップ'), []).ok).toBe(true);
    expect(checkIntent(voteObs('madman', true), vote('スキップ'), []).ok).toBe(true);
  });

  it('プロンプトに、局面と人数を書く（最後の局面の時だけ）', () => {
    expect(renderUser(voteObs('artisan', true))).toContain('【大事な局面】いま起きているのは3人で、ずんだの妖精はまだ1人残っています');
    expect(renderUser(voteObs('artisan', true))).toContain('スキップは負けを選ぶのと同じ');
    expect(renderUser(voteObs('artisan', false))).not.toContain('【大事な局面】いま');
  });
});
