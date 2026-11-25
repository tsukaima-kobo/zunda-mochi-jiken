// 最後の局面（ここで誰もクビにならないと、次に1人が餅になった時点で人狼の勝ち）では、従業員はスキップしない。

import type { MeetingObservation, RoamObservation } from '../../protocol/src/index.ts';
import { describe, expect, it } from 'vitest';
import { checkIntent, feedbackFor, renderRoamUser, renderUser } from '../src/index.ts';

function voteObs(role: MeetingObservation['self']['role'], lastChance: boolean): MeetingObservation {
  return {
    kind: 'meeting',
    phase: 'vote',
    self: { name: 'もえぎ', role, persona: '口調', style: '', allies: [] },
    facts: [],
    history: [],
    cast: { total: 11, nibblers: 2, madmen: 1 },
    stakes: { awake: lastChance ? 3 : 7, fairiesLeft: 1, lastChance, ...(lastChance ? { skipFatal: true } : {}) },
    meeting: { reason: '鐘', absent: [], round: 2, maxRounds: 2, attendees: ['もえぎ', 'あかね', 'つゆくさ'], transcript: [] },
    options: ['あかね', 'つゆくさ', 'スキップ'],
    limits: { sayTargetChars: 60, sayMaxChars: 80 },
  };
}

const vote = (choice: string) => ({ thought: 'うーん', vote: choice, memo: '', suspicion: [] });

describe('最後の局面', () => {
  it('従業員のスキップは、一度聞き直す（ガードで止める。soft）。誰かに入れれば通る', () => {
    const obs = voteObs('artisan', true);
    const skip = checkIntent(obs, vote('スキップ'), []);
    expect(skip.ok).toBe(false);
    expect(skip.ok ? [] : skip.problems).toContain('last_chance_skip');
    // 手は指定せず、人数を伝えて、気づかせる（誰に入れるかは AI 任せ）
    const feedback = feedbackFor(skip.ok ? [] : skip.problems, obs);
    expect(feedback).toContain('いま出席しているのは3人で、人狼はまだ1人残っています');
    expect(feedback).toContain('この選び方でよいですか');
    expect(feedback).not.toContain('いちばん怪しい人に入れて');
    expect(checkIntent(obs, vote('つゆくさ'), []).ok).toBe(true);
  });

  it('最後の局面でなければ、スキップしてよい。人狼と狂信者は、いつでもスキップしてよい', () => {
    expect(checkIntent(voteObs('artisan', false), vote('スキップ'), []).ok).toBe(true);
    expect(checkIntent(voteObs('nibbler', true), vote('スキップ'), []).ok).toBe(true);
    expect(checkIntent(voteObs('madman', true), vote('スキップ'), []).ok).toBe(true);
  });

  it('プロンプトに、局面と人数を書く（最後の局面の時だけ）', () => {
    expect(renderUser(voteObs('artisan', true))).toContain('【大事な局面】いま起きているのは3人で、人狼はまだ1人残っています');
    expect(renderUser(voteObs('artisan', true))).toContain('スキップは負けを選ぶのと同じ');
    expect(renderUser(voteObs('artisan', false))).not.toContain('【大事な局面】いま');
  });
});

describe('妖狐がまだ起きているかもしれない最後の局面', () => {
  const withFox = (role: MeetingObservation['self']['role']): MeetingObservation => ({
    ...voteObs(role, true),
    cast: { total: 11, nibblers: 2, madmen: 1, foxes: 1 },
    stakes: { awake: 5, fairiesLeft: 1, lastChance: true, foxUp: true, skipFatal: true },
  });

  it('従業員と占い師には、人数の数え方（見回りのたびに1人ずつ餅になる）と、スキップは負けと伝える。誰に入れるかは言わない', () => {
    for (const role of ['artisan', 'seer'] as const) {
      const text = renderUser(withFox(role));
      expect(text).toContain('【大事な局面】いま起きているのは5人で、人狼はまだ1人残っています');
      expect(text).toContain('見回りのたびに従業員が1人ずつ餅にされて、従業員は勝てなくなります');
      expect(text).toContain('妖狐も、まだ起きているかもしれません');
      expect(text).toContain('スキップは負けを選ぶのと同じ');
    }
  });

  it('妖狐がいない時の文は、これまでどおり', () => {
    expect(renderUser(voteObs('artisan', true))).not.toContain('妖狐も、まだ起きているかもしれません');
  });

  it('従業員のスキップは、5人の局面でも一度聞き直す', () => {
    const skip = checkIntent(withFox('artisan'), vote('スキップ'), []);
    expect(skip.ok).toBe(false);
    expect(skip.ok ? [] : skip.problems).toContain('last_chance_skip');
  });
});

describe('人狼への文: セルフ通報', () => {
  it('セルフ通報を、標準の手として勧めない（たいてい悪手と書く）', () => {
    const obs = {
      kind: 'roam',
      self: { name: 'さくら', role: 'nibbler', persona: '口調', style: '', allies: [] },
      cast: { total: 11, nibblers: 2, madmen: 1, foxes: 1 },
      round: 2,
      clock: 70,
      secondsUntilOpening: 0,
      taskBar: { done: 10, total: 80 },
      away: [],
      roster: ['さくら', 'きいろ', 'あかね'],
      history: [],
      where: '東の廊下',
      visible: [],
      events: [],
      activity: '歩いている',
      crossSeconds: 30,
      layout: [],
      rooms: ['東の廊下'],
      actions: ['move_to', 'wait'],
      tasks: [],
    } as unknown as RoamObservation;
    const text = renderRoamUser(obs);
    expect(text).toContain('セルフ通報');
    expect(text).toContain('たいてい悪手');
    expect(text).not.toContain('自分が見つけたふりをして report で知らせます。');
  });
});

describe('スキップの原則（案内の1〜2文だけ。局面ごとの指示は入れない）', () => {
  it('従業員・占い師の案内に、スキップしてよい場合と、いけない場合（占い師が出てこない・妖狐が起きているかもしれない）を、原則として書く', () => {
    for (const role of ['artisan', 'seer'] as const) {
      const text = renderUser({ ...voteObs(role, false), stakes: null });
      expect(text).toContain('スキップは、人狼に、見回り1回ぶん（餅を1人）を渡す手です');
      expect(text).toContain('占い師が生きていて、結果が出る見込みがある間や、手がかりが何もない時は、スキップもあります');
      expect(text).toContain('占い師がもう出てこない試合で、妖狐が起きているかもしれない時は、当てずっぽうでも誰かに投票しないと勝てません');
      expect(text).not.toContain('基本しない');
    }
  });

  it('余裕・確率・「こう動け」の局面ごとの指示は、渡さない', () => {
    const obs: MeetingObservation = { ...voteObs('artisan', false), cast: { total: 11, nibblers: 2, madmen: 1, foxes: 1 }, stakes: { awake: 6, fairiesLeft: 1, lastChance: false, foxUp: true } };
    const text = renderUser(obs);
    expect(text).not.toContain('【大事な局面】');
    expect(text).not.toContain('余裕は');
    expect(text).not.toContain('当てずっぽうでも、誰かに入れます');
  });
});
