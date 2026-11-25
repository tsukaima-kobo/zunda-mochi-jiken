import { describe, expect, it } from 'vitest';
import { lastChanceOf } from '../src/observe.ts';
import { applyBallots, applySpeak, buildObservation, createWorld, currentSpeaker, priorityOrder, resolveBallots, RuleViolation } from '../src/index.ts';

const seats = ['a', 'b', 'c', 'd'];

describe('票の集計', () => {
  it('最多が1人だけ・2票以上・棄権より多いときだけ、クビにする', () => {
    const outcome = resolveBallots(seats, { a: 'b', b: 'c', c: 'b', d: 'skip' });
    expect(outcome.verdict).toBe('ejected');
    expect(outcome.ejectedId).toBe('b');
    expect(outcome.tally[0]).toEqual({ target: 'b', count: 2 });
  });

  it('最多が同数なら誰も帰らない', () => {
    expect(resolveBallots(seats, { a: 'b', b: 'a', c: 'b', d: 'a' })).toMatchObject({ verdict: 'tie', ejectedId: null });
  });

  it('最多が1票なら誰も帰らない', () => {
    expect(resolveBallots(seats, { a: 'b', b: 'c', c: 'd', d: 'skip' })).toMatchObject({ verdict: 'too_few', ejectedId: null });
    expect(resolveBallots(seats, { a: 'skip', b: 'skip', c: 'skip', d: 'skip' })).toMatchObject({ verdict: 'too_few' });
  });

  it('棄権が最多以上なら誰も帰らない', () => {
    expect(resolveBallots(seats, { a: 'b', b: 'skip', c: 'b', d: 'skip' })).toMatchObject({ verdict: 'skip_wins', ejectedId: null });
  });

  it('票が揃っていなければ集計しない', () => {
    expect(() => resolveBallots(seats, { a: 'b', b: 'c', c: 'b' })).toThrow(RuleViolation);
  });
});

describe('発言順', () => {
  const name = (id: string) => ({ a: 'あかね', b: 'あおい', c: 'みどり', d: 'きいろ' })[id] as string;

  it('前の巡で名前を出された人が先。同数は席順', () => {
    const order = priorityOrder(
      seats,
      [
        { round: 1, speakerId: 'a', text: 'みどりはどこにいたの？' },
        { round: 1, speakerId: 'b', text: 'みどりもきいろも見てないよ' },
        { round: 1, speakerId: 'c', text: 'みどりはずっと蒸し場にいたよ' }, // 自分の名前を言っても数えない
      ],
      name,
    );
    expect(order).toEqual(['c', 'd', 'a', 'b']);
  });

  it('第1巡は通報者から始まり、全員が1回ずつ話す', () => {
    const world = createWorld({ seed: 7 });
    expect(currentSpeaker(world)).toBe(world.meeting.reporterId);
    const spoke: string[] = [];
    while (world.meeting.round === 1 && world.meeting.phase === 'speak') {
      const id = currentSpeaker(world) as string;
      spoke.push(id);
      applySpeak(world, id, '発言');
    }
    expect([...spoke].sort()).toEqual([...world.meeting.seats].sort());
  });
});

describe('会議のルール', () => {
  it('番でない人・長すぎる発言・空の発言は受け付けない', () => {
    const world = createWorld({ seed: 3 });
    const speaker = currentSpeaker(world) as string;
    const other = world.meeting.seats.find((id) => id !== speaker) as string;
    expect(() => applySpeak(world, other, 'こんにちは')).toThrow(/番ではありません/);
    expect(() => applySpeak(world, speaker, 'あ'.repeat(world.config.sayMaxChars + 1))).toThrow(/字以内/);
    expect(() => applySpeak(world, speaker, '   ')).toThrow(/空/);
    expect(world.meeting.transcript).toHaveLength(0);
  });

  it('全員が全巡を話し終えると投票になり、投票が済むと終わる', () => {
    const world = createWorld({ seed: 5, config: { maxRounds: 2 } });
    for (let id = currentSpeaker(world); id !== null; id = currentSpeaker(world)) applySpeak(world, id, '発言');
    expect(world.meeting.phase).toBe('vote');
    expect(world.meeting.transcript).toHaveLength(world.meeting.seats.length * 2);
    const [first, second] = world.meeting.seats as [string, string];
    expect(() => applyBallots(world, { ...Object.fromEntries(world.meeting.seats.map((id) => [id, 'skip'])), [first]: first })).toThrow(/自分/);
    const outcome = applyBallots(world, Object.fromEntries(world.meeting.seats.map((id) => [id, id === first ? second : first])));
    expect(world.meeting.phase).toBe('done');
    expect(outcome.ejectedId).toBe(first);
  });
});

describe('会議の前の状況', () => {
  it('同じ種なら同じ状況になる', () => {
    expect(createWorld({ seed: 42 })).toEqual(createWorld({ seed: 42 }));
    expect(createWorld({ seed: 42 })).not.toEqual(createWorld({ seed: 43 }));
  });

  it('事件の時刻に現場にいたのは犯人と被害者だけで、犯人以外は事件を見ていない', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const world = createWorld({ seed });
      const { nibblerId, victimId, deedRoom, deedTime } = world.truth;
      const slot = ['02:00', '02:20', '02:40', '03:00'].indexOf(deedTime);
      const present = world.players.filter((p) => world.truth.timeline[p.id]?.[slot] === deedRoom).map((p) => p.id);
      expect(present.sort()).toEqual([nibblerId, victimId].sort());
      for (const p of world.players) {
        const sawDeed = p.facts.some((fact) => fact.includes('ずんだ餅に変えた'));
        expect(sawDeed).toBe(p.id === nibblerId);
      }
      expect(world.meeting.seats).not.toContain(victimId);
      expect(world.meeting.reporterId).not.toBe(nibblerId);
    }
  });
});

describe('黙ってよい集会', () => {
  it('最初の発言は黙れない。2人目からは、空の発言で黙れる（記録に残らず、次の人の番になる）', () => {
    const world = createWorld({ seed: 3 });
    const first = currentSpeaker(world) as string;
    expect(() => applySpeak(world, first, '')).toThrow(/空/);
    applySpeak(world, first, '見つけた時、そばには誰もいなかった。');
    const second = currentSpeaker(world) as string;
    expect(buildObservation(world, second).mayPass).toBe(true);
    applySpeak(world, second, '  ');
    expect(world.meeting.transcript).toHaveLength(1);
    expect(currentSpeaker(world)).not.toBe(second);
  });

  it('全員が黙っても、巡は進み、投票になる', () => {
    const world = createWorld({ seed: 5, config: { maxRounds: 2 } });
    applySpeak(world, currentSpeaker(world) as string, '発言');
    for (let id = currentSpeaker(world); id !== null; id = currentSpeaker(world)) applySpeak(world, id, '');
    expect(world.meeting.phase).toBe('vote');
    expect(world.meeting.transcript).toHaveLength(1);
  });

  it('黙れない設定（前の試合と同じ）では、空の発言を受け付けず、観測に mayPass が出ない', () => {
    const world = createWorld({ seed: 3, config: { allowPass: false } });
    applySpeak(world, currentSpeaker(world) as string, '発言');
    const next = currentSpeaker(world) as string;
    expect(buildObservation(world, next).mayPass).toBeUndefined();
    expect(() => applySpeak(world, next, '')).toThrow(/空/);
  });
});

// 人数の読みの本体は endgame.ts（試験は endgame.test.ts）。ここは、集会の観測に出る「最後の局面」の判定だけ。
describe('最後の局面（ここで誰もクビにならないと、従業員が勝てなくなる）', () => {
  it('妖狐がいなければ、人狼1人なら3人。人狼2人なら（見回りで2人が餅になることを見込んで）5〜6人', () => {
    expect(lastChanceOf(3, 1, 0)).toBe(true);
    expect(lastChanceOf(4, 1, 0)).toBe(false);
    expect(lastChanceOf(5, 2, 0)).toBe(true);
    expect(lastChanceOf(6, 2, 0)).toBe(true);
    expect(lastChanceOf(7, 2, 0)).toBe(false);
  });

  it('妖狐がまだ起きているかもしれない時は、妖狐も数える（人狼1・妖狐1なら5人。4人以下は、もう勝てないので「最後」ではない）', () => {
    expect(lastChanceOf(5, 1, 1)).toBe(true);
    expect(lastChanceOf(6, 1, 1)).toBe(false);
    expect(lastChanceOf(4, 1, 1)).toBe(false);
    expect(lastChanceOf(7, 2, 1)).toBe(true);
    expect(lastChanceOf(8, 2, 1)).toBe(true);
    expect(lastChanceOf(9, 2, 1)).toBe(false);
  });

  it('人狼がもういなければ、最後の局面ではない', () => {
    expect(lastChanceOf(3, 0, 1)).toBe(false);
  });
});
