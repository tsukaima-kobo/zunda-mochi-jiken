import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMatch } from '../../server/src/index.ts';
import { buildShow, clockAt, INTRO_SECONDS, posesAt, roamClockAt, segmentAt, showTimeOf, SLOW_SPEED } from '../src/show.ts';
import type { MeetingSegment, RoamSegment } from '../src/show.ts';

const map = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../../content/maps/workshop-small.json'), 'utf8'));
// 声と見せ場の多い、長めの試合の種（台本ボットは名前を乱数のたねに使うので、登場人物を変えたら選び直す）
const SEEDS = [15, 37, 11, 32];
const play = (seed: number, players = 6) => runMatch({ seed, map, players, brains: [null], denyList: [] });

describe('上映の時間軸', () => {
  it('場面がすき間なく並び、見回りの長さは試合の中の時間と同じになる', async () => {
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      expect(show.segments[0]).toEqual({ kind: 'intro', start: 0, end: INTRO_SECONDS });
      expect(show.segments.at(-1)!.kind).toBe('ending');
      show.segments.reduce((end, segment) => {
        expect(segment.start).toBeCloseTo(end, 6);
        expect(segment.end).toBeGreaterThanOrEqual(segment.start);
        return segment.end;
      }, 0);
      expect(show.total).toBeCloseTo(show.segments.at(-1)!.end, 6);
      const roams = show.segments.filter((s): s is RoamSegment => s.kind === 'roam');
      // 見回りの終わりに、最後の声が鳴り終わるまで絵を止めて待つ分（held）は、試合の中の時間に入らない
      for (const s of roams) expect(s.held ?? 0).toBeLessThanOrEqual(9);
      expect(roams.reduce((sum, s) => sum + (roamClockAt(s, s.end - (s.held ?? 0)) - s.clock0), 0)).toBeCloseTo(log.result!.clock, 6);
      // 声が詰まっている所では絵をゆっくり流す。速さは SLOW_SPEED から 1 のあいだで、戻ったり止まったりしない
      for (const s of roams) {
        const warp = s.warp ?? [];
        for (let i = 2; i < warp.length; i += 2) {
          const clock = warp[i]! - warp[i - 2]!;
          const shown = warp[i + 1]! - warp[i - 1]!;
          expect(clock).toBeGreaterThanOrEqual(0);
          expect(shown).toBeGreaterThanOrEqual(clock - 1e-9);
          expect(shown).toBeLessThanOrEqual(clock / SLOW_SPEED + 1e-9);
        }
        for (const t of [0.3, 7.1, 40.2]) expect(roamClockAt(s, showTimeOf(s, s.clock0 + t))).toBeCloseTo(s.clock0 + t, 6);
      }
      expect(roams.map((s) => s.round)).toEqual(roams.map((_, i) => i + 1));
      // 試合の中の時計は、集会のあいだ止まり、最後に終わった時刻になる
      expect(clockAt(show, 0)).toBe(0);
      expect(clockAt(show, show.total)).toBeCloseTo(log.result!.clock, 6);
      for (const s of show.segments) if (s.kind === 'meeting') expect(clockAt(show, s.end - 0.01)).toBeCloseTo(clockAt(show, s.start), 6);
    }
  });

  it('見回りの間の声は、前の声と重ならずに流れ、待ちすぎる声はふきだしだけになる。最後の声は鳴り終わってから集会へ移る', async () => {
    let voiced = 0;
    let muted = 0;
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      const chats = show.cues.filter((cue) => cue.event.type === 'chat');
      expect(chats).toHaveLength(log.events.filter((event) => event.type === 'chat').length);
      const roams = show.segments.filter((s): s is RoamSegment => s.kind === 'roam');
      const sounding = chats.filter((cue) => cue.voiced).sort((a, b) => a.at - b.at);
      sounding.reduce((end, cue) => {
        expect(cue.at).toBeGreaterThanOrEqual(end);
        return cue.end;
      }, -Infinity);
      for (const cue of chats) {
        const event = cue.event as Extract<typeof cue.event, { type: 'chat' }>;
        const roam = roams.find((r) => cue.at >= r.start - 1e-6 && cue.at <= r.end + 3 + 1e-6)!;
        expect(roam).toBeDefined();
        const said = showTimeOf(roam, event.t);
        // 声は、言った時より前には出ない。待たせるのは、雑談なら試合の中の時間で2秒まで、ひとりごとなら上映の時間で3秒まで
        expect(cue.at).toBeGreaterThanOrEqual(said - 1e-6);
        if (cue.voiced) {
          if (event.heard.length > 0) expect(roamClockAt(roam, cue.at) - event.t).toBeLessThanOrEqual(2 + 1e-6);
          else expect(cue.at - said).toBeLessThanOrEqual(3 + 1e-6);
          // 鳴っている声は、その見回りの中で鳴り終わる（集会の告知と重ならない）
          expect(cue.end).toBeLessThanOrEqual(roam.end + 1e-6);
          voiced++;
        } else {
          expect(cue.at).toBeCloseTo(said, 6);
          muted++;
        }
      }
    }
    expect(voiced).toBeGreaterThan(50);
    expect(muted).toBeGreaterThan(0);
  });

  it('餅に変える直前の見せ場は、変わる瞬間の直前に終わり、ほかの見せ場や見回りの声と重ならない', async () => {
    let count = 0;
    for (const seed of SEEDS) {
      const log = await play(seed);
      const show = buildShow(log, null);
      const naps = show.cues.filter((cue) => cue.event.type === 'nap');
      show.cutins.reduce((end, cut) => {
        expect(cut.at).toBeGreaterThanOrEqual(end);
        return cut.end;
      }, -Infinity);
      for (const cut of show.cutins) {
        count++;
        // 同じ瞬間に餅にした組は、どれも同じ差し込みに並ぶ
        const same = naps.filter((cue) => Math.abs(cue.at - (cut.end + 0.05)) < 1e-6);
        expect(same.length).toBeGreaterThan(0);
        expect(cut.pairs).toEqual(same.map((cue) => cue.event.type === 'nap' && { by: cue.event.by, target: cue.event.target }));
        expect(cut.end - cut.at).toBeGreaterThanOrEqual(1.1);
        expect(cut.end - cut.at).toBeLessThanOrEqual(2.1 + 1e-6);
        const roam = show.segments.find((s) => s.kind === 'roam' && cut.at >= s.start - 1e-6 && cut.end <= s.end + 1e-6);
        expect(roam).toBeDefined();
        for (const cue of show.cues) if (cue.event.type === 'chat' && cue.voiced) expect(cue.end <= cut.at || cue.at >= cut.end + 0.3).toBe(true);
      }
      // 見せ場を出せない餅化は、前の見せ場とほとんど同時のものだけ（同じ瞬間のものは、1つの見せ場に並ぶ）
      expect(show.cutins.reduce((n, cut) => n + cut.pairs.length, 0)).toBeGreaterThanOrEqual(naps.length - 2);
    }
    expect(count).toBeGreaterThan(10);
  });

  it('集会は、告知 → 発言（重ならない）→ 投票 → 開票 → 結果 の順に並ぶ', async () => {
    const show = buildShow(await play(3), null);
    const meetings = show.segments.filter((s): s is MeetingSegment => s.kind === 'meeting');
    expect(meetings.length).toBeGreaterThan(0);
    for (const meeting of meetings) {
      const speaks = show.cues.filter((c) => c.event.type === 'speak' && c.at >= meeting.start && c.at < meeting.end);
      expect(speaks.length).toBe(meeting.info.attendees.length * 2);
      expect(speaks[0]!.at).toBeCloseTo(meeting.talkStart, 6);
      speaks.reduce((end, cue) => {
        expect(cue.at).toBeGreaterThanOrEqual(end);
        return cue.end;
      }, meeting.talkStart);
      expect(meeting.voteStart).toBeGreaterThanOrEqual(speaks.at(-1)!.end);
      expect(meeting.revealAt).toBeGreaterThan(meeting.voteStart);
      expect(meeting.resultAt).toBeGreaterThan(meeting.revealAt);
      expect(meeting.end).toBeGreaterThan(meeting.resultAt);
      expect(meeting.votes.length).toBe(meeting.info.attendees.length);
      // 票は全員同時に開く
      const votes = show.cues.filter((c) => c.event.type === 'vote' && c.at >= meeting.start && c.at < meeting.end);
      expect(new Set(votes.map((c) => c.at))).toEqual(new Set([meeting.revealAt]));
    }
  });

  it('音声を付けた発言は、音声の長さに合わせて並べ直される', async () => {
    const log = await play(3);
    const plain = buildShow(log, null);
    const voiced = buildShow(log, { version: 1, engine: 'test', clips: [{ speak: 0, file: 'speech/000.wav', seconds: 9.5, speaker: 'x', credit: 'y' }] });
    const first = voiced.cues.find((c) => c.event.type === 'speak')!;
    expect(first.clip?.file).toBe('speech/000.wav');
    // 音声の長さ＋発言のあとの余白（0.2秒）
    expect(first.end - first.at).toBeCloseTo(9.7, 6);
    const before = plain.cues.find((c) => c.event.type === 'speak')!;
    expect(voiced.total - plain.total).toBeCloseTo(9.7 - (before.end - before.at), 6);
  });

  it('見回りの位置は、コマのあいだをなめらかにつなぎ、ずんだ餅になった人は動かない', async () => {
    const log = await play(3);
    const show = buildShow(log, null);
    const roam = show.segments.find((s): s is RoamSegment => s.kind === 'roam')!;
    const tick = log.roam!.config.tickSeconds;
    const speed = log.roam!.config.speed;
    let previous = posesAt(show, roam, roam.start);
    for (let t = roam.start + tick / 4; t < roam.end; t += tick / 4) {
      const now = posesAt(show, roam, t);
      now.forEach((pose, i) => {
        const moved = Math.hypot(pose.x - previous[i]!.x, pose.y - previous[i]!.y);
        expect(moved).toBeLessThanOrEqual((speed * tick) / 4 + 0.011); // 記録の位置は小数2桁に丸めてある
        if (pose.state !== 'a') expect(pose.moving).toBe(false);
      });
      previous = now;
    }
    expect(segmentAt(show, roam.start + 1)).toBe(roam);
  });

  it('途中で止まった記録でも、時間軸を作れる', async () => {
    const log = await play(3);
    const cut = { ...log, status: 'stopped_quota' as const, result: null, events: log.events.slice(0, log.events.findIndex((e) => e.type === 'speak') + 3) };
    const show = buildShow(cut, null);
    expect(show.total).toBeGreaterThan(INTRO_SECONDS);
    expect(show.segments.at(-1)!.kind).toBe('meeting');
    expect(show.segments.at(-1)!.end).toBeCloseTo(show.total, 6);
  });
});

describe('画面に出す内心', () => {
  it('行動の英字の名前を、ふつうの言葉に直す（記録は変えない）', async () => {
    const { plainThought } = await import('../src/theme.ts');
    expect(plainThought('いま transform_if_unseen を使うと見られる。report はできない。')).toBe('いま「こっそり餅に変える」を使うと見られる。「知らせる」はできない。');
    expect(plainThought('見られたまま transform をすると危ない')).toBe('見られたまま「ずんだ餅に変える」をすると危ない');
    // 前の題材の記録（行動の名前が nap だった頃）も、同じ言葉に直す
    expect(plainThought('いま nap_if_unseen を使うと見られる。report はできない。')).toBe('いま「こっそり餅に変える」を使うと見られる。「知らせる」はできない。');
    expect(plainThought('見られたまま nap をすると危ない')).toBe('見られたまま「ずんだ餅に変える」をすると危ない');
    expect(plainThought('みどりは休憩室でずんだ餅になっている。')).toBe('みどりは休憩室でずんだ餅になっている。');
    expect(plainThought('transformer と napkin')).toBe('transformer と napkin');
  });
});
