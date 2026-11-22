// カメラの係。見回りのあいだ、誰をどのくらいの近さで映すかを、記録から決める。
// 記録は先まで分かっているので、人をずんだ餅に変える少し前から、変える妖精を追いかけることができる。
// 見どころ: ずんだ餅に変える、見つけて知らせる、鐘を鳴らす、妨害が始まる、困りごとを直す、床下の抜け道を通る。
// どの時刻のカメラも、その時刻だけから決まる（再生位置を動かしても同じ絵になる）。

import { isUp, posesAt } from './show.ts';
import type { MatchEvent } from '../../server/src/match-core.ts';
import type { Cue, RoamSegment, Show } from './show.ts';
import { easeInOut, H, lerp, W } from './theme.ts';

/** 画面の中で、カメラの中心を置く所（右の名簿と下の帯を避けた、空いている所の真ん中）。 */
export const ANCHOR_X = 740;
export const ANCHOR_Y = 520;
/** 画面の端のうち、札や名簿に隠れる幅。マップの端は、ここまでは入ってきてよい。 */
const PAD = { left: 20, right: 440, top: 96, bottom: 150 };
/** 映す近さ（升目1つが画面で何ピクセルか）。follow は、追っている人の見える範囲がちょうど画面に収まるくらい。 */
export const ZOOM = { follow: 64, close: 84 };

const BLEND_SECONDS = 1.1;
const NEAR_TILES = 13;
/** 同じ話の輪とみなす近さ（升）。前に話した人からこの近さで続いた声は、ひとつの場面にまとめる。 */
const TALK_TILES = 9;
/** 道具を見ている人を映す長さの上限（秒）。防犯カメラは長く見続けることがあるので、頭のこの秒数だけ。 */
const LOOK_SHOT_MAX = 6;
/** 餅に変わった瞬間から、その場面を映し続ける秒数。 */
const NAP_HOLD = 3.4;
/** 見られた抜け道の出口の前で切った「餅に変える場面」に、残す長さ（秒）。前の場面を早めに切り上げて作る。 */
const NAP_BEFORE_EXIT = 2.4;
/**
 * 声は工房のあちこちから順に鳴るので、声のたびに追うと、数秒ごとに別の部屋へ飛ぶ。遠くの声は、この秒数がたつまでは追わず、
 * 字幕（話している人の名前つき）だけで聞かせる。見どころ（餅に変える・知らせる・鐘・妨害・直す・抜け道）は、いつでも追う。
 */
export const HOLD_SECONDS = 14;
/** 話している所のあいだのすき間を、よそへ飛ばずに、前の場面を延ばして埋める長さの上限。 */
const BRIDGE_SECONDS = 20;
/** ふたりを映す場面を延ばしてよい、ふたりの離れ具合の上限（升）。 */
const PAIR_KEEP_TILES = 8;
/** 餅を見たのに通りすぎた人の、餅にいちばん近づいた時をさがす長さ（答えが返った時から、この秒数だけさかのぼる）。 */
const PASS_LOOK_BACK = 8;
/** 餅にいちばん近づいてから、餅と一緒に映し続ける秒数。 */
const PASS_PAIR_AFTER = 1.4;

export interface Shot {
  start: number;
  end: number;
  /** overview: 工房の全体 / follow: ひとりを追う / pair: ふたりを一緒に映す / place: 決まった場所を映す（閉まった戸など） */
  kind: 'overview' | 'follow' | 'pair' | 'place';
  /** 追う人（席の番号）。overview と place では使わない。 */
  subject: number;
  /** pair のとき、一緒に映す相手。 */
  other: number;
  zoom: number;
  /**
   * start: 見回りの始まり / patrol: 順番に追う / target: このあと狙われる人 / nap: ずんだ餅に変える（名前は前の題材のなごり） / report: 見つけて知らせる /
   * bell: 中庭の鐘を鳴らしに行く / sabotage: 妨害が始まる / fix: 困りごとを直す / sneak: 床下の抜け道を通る / chat: 声に出して話している /
   * look: 工房の道具（見取り図の盤・名札かけ・防犯カメラの画面）を見ている /
   * pass: ずんだ餅を見たのに、知らせる前に通りすぎる
   */
  why: 'start' | 'patrol' | 'target' | 'nap' | 'divine' | 'report' | 'bell' | 'sabotage' | 'fix' | 'sneak' | 'chat' | 'look' | 'pass';
  /** place のとき、映す場所（升目の座標）。 */
  at?: { x: number; y: number };
}

/** カメラの係が知っておく場所（升目の座標）。 */
export interface Sites {
  /** 部屋の名前 → 部屋の真ん中（戸が閉まった時に映す）。 */
  rooms?: Record<string, { x: number; y: number }>;
  /** 困りごと → 直す場所。 */
  fix?: Partial<Record<'lights' | 'crisis', { x: number; y: number }[]>>;
}

export interface Camera {
  /** カメラの中心（升目の座標）。 */
  x: number;
  y: number;
  /** 升目1つが画面で何ピクセルか。 */
  zoom: number;
  /** 追っている人（席の番号）。全体を映している時は null。 */
  subject: number | null;
  shot: Shot;
  /** 追っている人の「見えている範囲」を出す濃さ（0〜1）。 */
  shade: number;
  /** 場面が切り替わってからの秒数（なめらかにつないだ時は Infinity）。 */
  sinceCut: number;
}

interface Cast {
  seat: number;
  name: string;
  nibbler: boolean;
}

export class Director {
  private readonly show: Show;
  private readonly cast: Cast[];
  private readonly cols: number;
  private readonly rows: number;
  private readonly sites: Sites;
  private readonly cache = new Map<string, Shot[]>();

  constructor(show: Show, cast: Cast[], cols: number, rows: number, sites: Sites = {}) {
    this.show = show;
    this.cast = cast;
    this.cols = cols;
    this.rows = rows;
    this.sites = sites;
  }

  /** マップ全体が入る近さ。 */
  private fitZoom(): number {
    return Math.min(ZOOM.follow, (W - PAD.left - PAD.right) / (this.cols + 1), (H - PAD.top - PAD.bottom) / (this.rows + 1));
  }

  /** 小さいマップ（全体を映しても人が十分大きい）では、カメラを動かさず、いつも全体を映す。 */
  private get small(): boolean {
    return this.fitZoom() >= 44;
  }

  private seatOf(name: string): number {
    return this.cast.find((member) => member.name === name)?.seat ?? 0;
  }

  /** その見回りの、場面の並び。 */
  shotsFor(segment: RoamSegment, secrets: boolean): Shot[] {
    const key = `${segment.start}:${secrets}`;
    const cached = this.cache.get(key);
    if (cached) return cached;
    const { start, end } = segment;
    const inside = (cue: Cue) => cue.at >= start - 0.01 && cue.at <= end + 0.01;
    const cues = this.show.cues.filter(inside);

    const posesOn = (time: number) => posesAt(this.show, segment, Math.min(end - 0.001, Math.max(start, time)));
    /** その場所にいちばん近い、起きている人（役職を見ないで選ぶ）。 */
    const nearest = (place: { x: number; y: number } | undefined, time: number): number | null => {
      const poses = posesOn(time);
      let best: number | null = null;
      let near = Infinity;
      for (const member of this.cast) {
        const pose = poses[member.seat];
        if (!isUp(pose)) continue;
        const d = place ? Math.hypot(pose.x - place.x, pose.y - place.y) : member.seat;
        if (d >= near) continue;
        near = d;
        best = member.seat;
      }
      return best;
    };
    const lastDecided = (name: string, action: string, before: number) =>
      cues.filter((c) => c.event.type === 'decide' && c.event.agent === name && c.event.applied && c.event.action === action && c.at <= before).at(-1);

    // 見どころ。key は、その場面でいちばん見せたい瞬間（ほかの見どころと重なった時も、ここは残す）
    const naps: Shot[] = [];
    /** 抜け道から出てくる所を、妖精でない人に見られた瞬間（渡す場面と同じく、必ず映す）。 */
    const seenExits: Shot[] = [];
    const extras: { shot: Shot; key: number; rank: number }[] = [];
    for (const cue of cues) {
      const { event } = cue;
      if (event.type === 'nap') {
        const giver = this.seatOf(event.by);
        const target = this.seatOf(event.target);
        if (secrets) {
          // 渡すと決めた時から追う（短すぎず、長すぎず）
          // 行動の名前は transform（前の題材の記録では nap）
          const decided = cues.filter((c) => c.event.type === 'decide' && c.event.agent === event.by && c.event.applied && (c.event.action.startsWith('transform') || c.event.action.startsWith('nap')) && c.at <= cue.at).at(-1);
          const lead = Math.min(7, Math.max(2.5, cue.at - (decided?.at ?? cue.at) + 0.6));
          naps.push({ start: cue.at - lead, end: cue.at + NAP_HOLD, kind: 'pair', subject: giver, other: target, zoom: ZOOM.close, why: 'nap' });
        } else {
          // 役職を隠している時は、誰が渡したかを先に教えない
          naps.push({ start: cue.at - 0.2, end: cue.at + NAP_HOLD, kind: 'follow', subject: target, other: target, zoom: ZOOM.close, why: 'nap' });
        }
      } else if (event.type === 'nap_failed') {
        // 妖精が狐に手をかざしたが、餅にならなかった（役職を見せている時だけ。手をかざすと決めた所から）
        if (secrets) {
          const decided = cues.filter((c) => c.event.type === 'decide' && c.event.agent === event.by && c.event.applied && c.event.action.startsWith('transform') && c.at <= cue.at).at(-1);
          const lead = Math.min(6, Math.max(2.2, cue.at - (decided?.at ?? cue.at) + 0.6));
          extras.push({ shot: { start: cue.at - lead, end: cue.at + 3.4, kind: 'pair', subject: this.seatOf(event.by), other: this.seatOf(event.target), zoom: ZOOM.close, why: 'nap' }, key: cue.at + 0.3, rank: 0 });
        }
      } else if (event.type === 'divine') {
        const seer = this.seatOf(event.by);
        const target = this.seatOf(event.target);
        if (secrets) {
          // 占うと決めて近づく所から、結果の札が消えるまで。狐が餅になる時は、餅に変わる時と同じあつかい（ほかの見どころより先）
          const decided = lastDecided(event.by, 'divine', cue.at);
          const lead = Math.min(6, Math.max(2.2, cue.at - (decided?.at ?? cue.at) + 0.6));
          // 案内役が結果を言い終わるのが遅い時は、札が消える（cue.end + 0.8）まで映す
          const shot: Shot = { start: cue.at - lead, end: Math.max(cue.at + 3.6, cue.end + 1), kind: 'pair', subject: seer, other: target, zoom: ZOOM.close, why: 'divine' };
          if (event.cursed) naps.push(shot);
          else extras.push({ shot, key: cue.at + 0.3, rank: 0 });
        } else if (event.cursed) {
          // 役職を隠している時は、誰が占ったかを教えない（急に餅になった人だけを映す）
          naps.push({ start: cue.at - 0.2, end: cue.at + 3.4, kind: 'follow', subject: target, other: target, zoom: ZOOM.close, why: 'divine' });
        }
      } else if (event.type === 'decide' && event.action === 'report' && event.applied) {
        const reporter = this.seatOf(event.agent);
        // 「知らせる」と決めた時と、知らせた時（見回りの終わり）が離れる。決めた所から、餅のそばに着いて知らせる瞬間まで追う。
        // 途中でやめた時（ほかの人が先に知らせた、など）は、追わない。その前の試合（決めた瞬間に知らせている）は、今までと同じ
        const told = end - ((segment as { held?: number }).held ?? 0);
        // 次の区切りは、時刻でさがす（同じ試合から作った別の上映の区切りを渡されても、同じ答えになるように）
        const after = this.show.segments.find((s) => s.start >= end - 0.01);
        const leads = after?.kind === 'meeting' && after.info.kind === 'report' && after.info.reporter === event.agent && lastDecided(event.agent, 'report', Infinity) === cue;
        if (told - cue.at <= 0.3) {
          extras.push({ shot: { start: cue.at - 3.6, end: cue.at + 0.02, kind: 'follow', subject: reporter, other: reporter, zoom: ZOOM.close, why: 'report' }, key: cue.at - 0.05, rank: 0 });
        } else if (leads) {
          extras.push({ shot: { start: Math.min(cue.at - 1.2, told - 3.6), end: told + 0.02, kind: 'follow', subject: reporter, other: reporter, zoom: ZOOM.close, why: 'report' }, key: told - 0.05, rank: 0 });
        }
      } else if (event.type === 'decide' && event.action === 'report' && !event.applied && event.target && /見えていません/.test(event.note ?? '')) {
        // ずんだ餅を見て知らせようとしたが、答えが返った時には、もう通りすぎていた人。
        // 餅にいちばん近づいた時の少し前から、答えが返る時まで。このすぐあとに、案内役が「見たのに、知らせそこねた」と言う（narration.ts の saw）
        const walker = this.seatOf(event.agent);
        const mochi = this.seatOf(event.target);
        let near = cue.at;
        let closest = Infinity;
        for (let time = Math.max(start, cue.at - PASS_LOOK_BACK); time <= cue.at; time += 0.2) {
          const poses = posesOn(time);
          const a = poses[walker];
          const b = poses[mochi];
          if (!a || !b || a.state === 'x' || b.state === 'x') continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < closest) {
            closest = d;
            near = time;
          }
        }
        // 始まりは、近づく1秒前（その前に、妖精が抜け道へもぐる所などを映していることがあるので、長くは取らない）
        if (Number.isFinite(closest)) {
          // 餅と一緒に映すのは、通りすぎる間だけ。そのあとは本人を追う（離れていく2人を一緒に映すと、本人が字幕の後ろへ行く）
          const split = Math.min(cue.at, near + PASS_PAIR_AFTER);
          extras.push({ shot: { start: near - 1, end: split, kind: 'pair', subject: walker, other: mochi, zoom: ZOOM.follow, why: 'pass' }, key: near, rank: 0 });
          extras.push({ shot: { start: split, end: cue.at + 0.3, kind: 'follow', subject: walker, other: walker, zoom: ZOOM.follow, why: 'pass' }, key: split + 0.2, rank: 0 });
        }
      } else if (event.type === 'bell') {
        // 鐘を鳴らしに行くと決めた時から、鐘の前に着くまで
        const ringer = this.seatOf(event.by);
        const lead = Math.min(6, Math.max(2.5, cue.at - (lastDecided(event.by, 'call_meeting', cue.at)?.at ?? cue.at) + 0.4));
        extras.push({ shot: { start: cue.at - lead, end: cue.at + 0.02, kind: 'follow', subject: ringer, other: ringer, zoom: ZOOM.close, why: 'bell' }, key: cue.at - 0.05, rank: 0 });
      } else if (event.type === 'fixed') {
        // 直した人を、直す少し前から映す。ふたりで直した時は、ひとりずつ
        const fixers = event.by.map((name) => this.seatOf(name));
        // すぐに直った時は、困りごとが始まる前から映さない（1人目の場面が、始まる前に終わってしまうため）
        const began = cues.filter((c) => c.event.type === 'sabotage' && c.event.what === event.what && c.at <= cue.at).at(-1)?.at ?? -Infinity;
        const from = Math.max(cue.at - (fixers.length > 1 ? 5.4 : 3.8), began - 0.4);
        const until = cue.at + 1.8;
        const split = Math.max(cue.at - 2.2, (from + cue.at) / 2);
        fixers.forEach((seat, index) => {
          const a = index === 0 ? from : split;
          const b = index === fixers.length - 1 ? until : split;
          extras.push({ shot: { start: a, end: b, kind: 'follow', subject: seat, other: seat, zoom: ZOOM.close, why: 'fix' }, key: index === fixers.length - 1 ? cue.at - 0.05 : b - 0.3, rank: 1 });
        });
      } else if (event.type === 'sabotage') {
        if (event.what === 'door') {
          // 閉まった戸のある部屋を映す（誰が閉めたかは、どちらの時も映さない）
          const place = event.room ? this.sites.rooms?.[event.room] : undefined;
          if (place) extras.push({ shot: { start: cue.at - 0.4, end: cue.at + 3.4, kind: 'place', subject: 0, other: 0, zoom: ZOOM.follow, why: 'sabotage', at: place }, key: cue.at + 0.2, rank: 3 });
        } else if (secrets) {
          // 妨害した本人を、少し前から映す
          const by = this.seatOf(event.by);
          extras.push({ shot: { start: cue.at - 1.8, end: cue.at + 3, kind: 'follow', subject: by, other: by, zoom: ZOOM.close, why: 'sabotage' }, key: cue.at + 0.2, rank: 2 });
        } else {
          // 役職を隠している時は、直す場所にいちばん近い人を映す（誰のしわざかは教えない）
          const seat = nearest(this.sites.fix?.[event.what]?.[0], cue.at);
          if (seat !== null) extras.push({ shot: { start: cue.at - 0.2, end: cue.at + 3.6, kind: 'follow', subject: seat, other: seat, zoom: ZOOM.follow, why: 'sabotage' }, key: cue.at + 0.2, rank: 2 });
        }
      } else if (event.type === 'look' && event.phase === 'start') {
        // 道具を見ている人。見ている間は、見えたものを画面の隅に出す（scenes.ts）。防犯カメラは長いので、頭の数秒だけ
        const span = this.show.looks.find((s) => s.by === event.agent && Math.abs(s.start - cue.at) < 1e-6);
        const until = Math.min(span && Number.isFinite(span.end) ? span.end : cue.at + 2, cue.at + LOOK_SHOT_MAX);
        const seat = this.seatOf(event.agent);
        extras.push({ shot: { start: cue.at - 1, end: until + 0.5, kind: 'follow', subject: seat, other: seat, zoom: ZOOM.close, why: 'look' }, key: cue.at + 0.4, rank: 4 });
      } else if (event.type === 'sneak' && event.phase === 'in' && secrets) {
        // 抜け道へもぐる所から、出てくる所まで
        const span = this.show.sneaks.find((s) => s.by === event.by && Math.abs(s.start - cue.at) < 1e-6);
        const out = span && Number.isFinite(span.end) ? span.end : cue.at;
        const seat = this.seatOf(event.by);
        extras.push({ shot: { start: cue.at - 2.2, end: out + 1.6, kind: 'follow', subject: seat, other: seat, zoom: ZOOM.close, why: 'sneak' }, key: cue.at, rank: 4 });
      } else if (event.type === 'sneak' && event.phase === 'out' && secrets) {
        // 抜け道から出てくる所を、妖精でない人に見られた時は、その瞬間を、見た人と一緒に必ず映す。
        // （同じ時刻に別の場所で餅に変える場面があると、カメラがそちらへ行って、出てくる所が映らないことがあった）
        const eye = event.witnesses.map((name) => this.cast.find((member) => member.name === name)).find((member) => member !== undefined && !member.nibbler);
        if (eye) seenExits.push({ start: cue.at - 1, end: cue.at + 2.2, kind: 'pair', subject: this.seatOf(event.by), other: eye.seat, zoom: ZOOM.close, why: 'sneak' });
      }
    }
    // 話している所。続けて交わされた声（近くの人どうし）は、ひとつの場面にまとめる。ほかの見どころより後回し。
    // 前に話した人から TALK_TILES 升以内で続いた声は、同じ場面のまま
    const voiced = cues.filter((cue) => cue.event.type === 'chat' && cue.voiced).sort((a, b) => a.at - b.at);
    let talk: { first: Cue; last: Cue; seats: number[]; lastSeat: number } | null = null;
    const closeTalk = () => {
      if (!talk) return;
      const [a, b] = talk.seats as [number, number | undefined];
      const shot: Shot = { start: talk.first.at - 0.6, end: talk.last.end + 0.4, kind: b === undefined ? 'follow' : 'pair', subject: a, other: b ?? a, zoom: ZOOM.close, why: 'chat' };
      // いちばん見せたい瞬間は、話し始めの少しあと（前の人の場面の、終わりの余白と重なっても残るように）
      extras.push({ shot, key: talk.first.at + Math.min(0.8, (talk.first.end - talk.first.at) / 2), rank: 5 });
      talk = null;
    };
    for (const cue of voiced) {
      const seat = this.seatOf((cue.event as Extract<MatchEvent, { type: 'chat' }>).speaker);
      if (talk) {
        const poses = posesOn(cue.at);
        const distance = (a: number, b: number) => {
          const p = poses[a];
          const q = poses[b];
          return isUp(p) && isUp(q) ? Math.hypot(p.x - q.x, p.y - q.y) : Infinity;
        };
        // 話の輪が少しずつ移って、最初の人から離れすぎたら、場面を分ける（近いので、カメラはなめらかに移る）
        const near = distance(seat, talk.lastSeat) <= TALK_TILES && distance(seat, talk.seats[0] as number) <= TALK_TILES * 1.4;
        if (near && cue.at - talk.last.end <= 4) {
          talk.last = cue;
          talk.lastSeat = seat;
          if (!talk.seats.includes(seat) && talk.seats.length < 2) talk.seats.push(seat);
          continue;
        }
        closeTalk();
      }
      talk = { first: cue, last: cue, seats: [seat], lastSeat: seat };
    }
    closeTalk();

    // 見られた抜け道の出口は、渡す場面より先に取る（重なる渡す場面は、出口の前で切る。出口の間に始まるものは、出口のあとへ）
    const napMoment = new Map(naps.filter((shot) => shot.why === 'nap').map((shot) => [shot, shot.end - NAP_HOLD] as const));
    for (const exit of seenExits) {
      for (const shot of naps) {
        if (shot.end <= exit.start || shot.start >= exit.end) continue;
        if (shot.start >= exit.start) {
          shot.start = exit.end;
          continue;
        }
        shot.end = exit.start;
        // 出口の前で切った場面が、その前の渡す場面に押されて一瞬だけにならないように、前の場面を早めに切り上げる
        // （前の場面も、餅に変わった所を 1.2 秒は見せる）
        for (const before of naps) {
          const moment = napMoment.get(before);
          if (before === shot || moment === undefined || before.start > shot.start || before.end <= shot.start) continue;
          before.end = Math.max(moment + 1.2, Math.min(before.end, shot.end - NAP_BEFORE_EXIT));
        }
      }
      naps.push(exit);
    }
    // 渡す場面を先に取り、ほかの見どころは、その残りの時間に入れる（渡す場面を削らない）
    const busy: Shot[] = [];
    let floor = start;
    for (const shot of naps.sort((a, b) => a.start - b.start)) {
      shot.start = Math.max(shot.start, floor);
      shot.end = Math.min(shot.end, end);
      if (shot.end - shot.start < 0.4) continue;
      busy.push(shot);
      floor = shot.end;
    }
    for (const { shot, key } of extras.sort((a, b) => a.rank - b.rank || a.shot.start - b.shot.start)) {
      shot.start = Math.max(shot.start, start);
      shot.end = Math.min(shot.end, end);
      let free = true;
      for (const other of busy) {
        if (shot.start >= other.end || shot.end <= other.start) continue;
        if (other.end <= key) shot.start = other.end;
        else if (other.start > key) shot.end = other.start;
        else free = false;
      }
      if (!free || shot.end - shot.start < (shot.why === 'report' || shot.why === 'bell' || shot.why === 'pass' ? 0.4 : 1.4)) continue;
      busy.push(shot);
    }
    busy.sort((a, b) => a.start - b.start);
    // 遠くの話へは、同じ場所を HOLD_SECONDS 映したあとでしか移らない（見どころは別）。遠いかどうかは、ぱっと切り替える時（cameraAt）と同じ決め方
    let settled = start;
    let anchor: Shot | null = null;
    for (let i = 0; i < busy.length; i++) {
      const shot = busy[i] as Shot;
      const far = (() => {
        if (!anchor) return true;
        const a = this.cameraOf(segment, anchor, shot.start);
        const b = this.cameraOf(segment, shot, shot.start);
        return Math.hypot(a.x - b.x, a.y - b.y) >= NEAR_TILES;
      })();
      if (shot.why === 'chat' && far && anchor && shot.start - settled < HOLD_SECONDS) {
        busy.splice(i, 1);
        i -= 1;
        continue;
      }
      if (far) settled = shot.start;
      anchor = shot;
    }
    // 鐘・知らせのあと、最後の声を待って絵を止めている間（held）は、鳴らした人・知らせた人を映したままにする
    const held = (segment as { held?: number }).held ?? 0;
    const alarm = busy.find((shot) => (shot.why === 'bell' || shot.why === 'report') && shot.end >= end - held - 0.05);
    if (alarm && held > 0) {
      const from = alarm.end;
      for (let i = busy.length - 1; i >= 0; i--) if (busy[i] !== alarm && (busy[i] as Shot).start >= from - 1e-6) busy.splice(i, 1);
      alarm.end = end;
    }

    const shots: Shot[] = [];
    let cursor = start;
    if (end - start > 9 && (busy[0]?.start ?? Infinity) - start > 5) {
      shots.push({ start, end: start + 2.6, kind: 'overview', subject: 0, other: 0, zoom: this.fitZoom(), why: 'start' });
      cursor = start + 2.6;
    }

    /** その間、ずっと工房の中に姿が見えている人（床下にもぐる人は、役職を隠している時に追うと、抜け道を教えてしまう）。 */
    const awakeAt = (time: number, until: number) => {
      const poses = posesAt(this.show, segment, time);
      const hidden = secrets ? [] : this.show.sneaks.filter((span) => span.start < until + 1 && span.end > time - 1).map((span) => span.seat);
      return this.cast.filter((member) => isUp(poses[member.seat]) && !hidden.includes(member.seat));
    };
    /**
     * その場面を from から to まで延ばしても、映している人がずっと見えているか。ふたりを映す場面は、ふたりが離れすぎない時だけ
     * （離れると、まん中に寄せたカメラで、片方が字幕の後ろへ行く）。
     */
    const keeps = (shot: Shot, from: number, to: number): boolean => {
      const seats = shot.kind === 'pair' ? [shot.subject, shot.other] : [shot.subject];
      if (!seats.every((seat) => awakeAt(from, to).some((m) => m.seat === seat) && awakeAt(to - 0.001, to).some((m) => m.seat === seat))) return false;
      if (shot.kind !== 'pair') return true;
      for (let time = from; time <= to; time += 0.5) {
        const poses = posesOn(time);
        const a = poses[shot.subject];
        const b = poses[shot.other];
        if (!isUp(a) || !isUp(b) || Math.hypot(a.x - b.x, a.y - b.y) > PAIR_KEEP_TILES) return false;
      }
      return true;
    };
    let turn = segment.round; // 見回りごとに、追い始める人を変える
    let previous = -1;
    const pick = (time: number, until: number): number => {
      const awake = awakeAt(time, until);
      if (awake.length === 0) return nearest(undefined, time) ?? 0;
      const nibblers = awake.filter((member) => member.nibbler);
      const others = awake.filter((member) => !secrets || !member.nibbler);
      turn += 1;
      // 役職を見せている時は、妖精とほかの人を交互に追う（妖精がふたりなら、そのふたりも交互に）
      const nibbler = nibblers[Math.floor(turn / 2) % Math.max(1, nibblers.length)];
      if (secrets && nibbler && turn % 2 === 0 && nibbler.seat !== previous) return nibbler.seat;
      const pool = others.filter((member) => member.seat !== previous);
      const list = pool.length > 0 ? pool : awake;
      return (list[Math.floor(turn / (secrets ? 2 : 1)) % list.length] as Cast).seat;
    };
    const fill = (from: number, to: number, next: Shot | null) => {
      const length = to - from;
      if (length < 0.05) return;
      const last = shots.at(-1);
      if (length < 3.5 && last && last.kind !== 'overview') {
        last.end = to; // 短いすき間は、前の場面を延ばす
        return;
      }
      // 話している所のあいだの、あまり長くないすき間は、よそへ飛ばない。次の話が近ければ（なめらかに移れる）、次の場面を早めに始め、
      // 遠ければ、前の場面を延ばす（遠くへ切り替えるのは、HOLD_SECONDS を確かめた次の場面の頭のまま）。
      // ただし、その間ずっと工房の中に姿が見えている人だけ（役職を隠している時に、床下にもぐる人を追うと、抜け道を教えてしまう）
      if (length <= BRIDGE_SECONDS && last && (last.kind === 'follow' || last.kind === 'pair') && (last.why === 'chat' || next?.why === 'chat')) {
        const near = next ? Math.hypot(this.cameraOf(segment, last, from).x - this.cameraOf(segment, next, from).x, this.cameraOf(segment, last, from).y - this.cameraOf(segment, next, from).y) < NEAR_TILES : false;
        if (next?.why === 'chat' && near && keeps(next, from, next.start)) return; // 次の場面が from から始まる（下の並べる所で、前の場面の終わりにそろえる）
        if (keeps(last, from, to)) {
          last.end = to;
          return;
        }
      }
      const count = Math.max(1, Math.round(length / 10));
      for (let i = 0; i < count; i++) {
        const s = from + (length / count) * i;
        const e = from + (length / count) * (i + 1);
        // 役職を見せている時は、渡す場面の前に、狙われる人を映しておく
        const doomed = secrets && next?.why === 'nap' && i === count - 1 && e - s >= 4 && next.other !== previous;
        // 次が話している所なら、最後の場面は、その話し手を先に映しておく（話が始まる所で、もう一度飛ばない）
        const lead = !doomed && next?.why === 'chat' && i === count - 1 && next.subject !== previous && awakeAt(s, e).some((member) => member.seat === next.subject);
        const subject = doomed && next ? next.other : lead && next ? next.subject : pick(s, e);
        previous = subject;
        shots.push({ start: s, end: e, kind: 'follow', subject, other: subject, zoom: ZOOM.follow, why: doomed ? 'target' : 'patrol' });
      }
    };
    for (const shot of busy) {
      fill(cursor, shot.start, shot);
      shot.start = shots.at(-1)?.end ?? shot.start;
      shots.push(shot);
      if (shot.kind !== 'place') previous = shot.subject;
      cursor = shot.end;
    }
    fill(cursor, end, null);
    // 並べ終わったあとで、もう一度確かめる: 遠くへ飛んでから HOLD_SECONDS たたないうちに、話している所へまた飛ぶなら、
    // 前の場面を延ばして映し続ける（声は字幕で聞かせる）。前の場面の人が、その間ずっと見えている時だけ
    let lastCut = start;
    for (let i = 1; i < shots.length; i++) {
      const shot = shots[i] as Shot;
      const before = shots[i - 1] as Shot;
      const a = this.cameraOf(segment, before, shot.start);
      const b = this.cameraOf(segment, shot, shot.start);
      if (before.kind === 'overview' || Math.hypot(a.x - b.x, a.y - b.y) < NEAR_TILES) continue;
      const followed = before.kind === 'follow' || before.kind === 'pair';
      const lone: Shot = { start: shot.start, end: shot.end, kind: 'follow', subject: before.subject, other: before.subject, zoom: ZOOM.follow, why: 'patrol' };
      if (shot.why === 'chat' && shot.start - lastCut < HOLD_SECONDS && followed && keeps(lone, shot.start, shot.end)) {
        if (keeps(before, shot.start, shot.end)) {
          before.end = shot.end;
          shots.splice(i, 1);
          i -= 1;
          continue;
        }
        // ふたりを映していて、片方が餅に変わった・床下へ行った・離れていった時は、片方に寄る（まだ近ければ、なめらかにつながる）
        const c = this.cameraOf(segment, lone, shot.start);
        if (Math.hypot(a.x - c.x, a.y - c.y) < NEAR_TILES) {
          shots.splice(i, 1, lone);
          continue;
        }
      }
      lastCut = shot.start;
    }
    // 同じ人を続けて順に追う場面は、ひとつにまとめる
    for (let i = shots.length - 1; i > 0; i--) {
      const a = shots[i - 1] as Shot;
      const b = shots[i] as Shot;
      if (a.kind === 'follow' && b.kind === 'follow' && a.why === 'patrol' && b.why === 'patrol' && a.subject === b.subject) {
        a.end = b.end;
        shots.splice(i, 1);
      }
    }
    if (shots.length === 0) shots.push({ start, end, kind: 'overview', subject: 0, other: 0, zoom: this.fitZoom(), why: 'start' });
    // 見回りの始まりから終わりまでを、すき間なく覆う
    (shots[0] as Shot).start = start;
    (shots.at(-1) as Shot).end = end;
    this.cache.set(key, shots);
    return shots;
  }

  /** 追っている人の位置。前後の時刻とならして、カメラが細かく揺れないようにする。 */
  private smooth(segment: RoamSegment, seat: number, time: number): { x: number; y: number } | null {
    let x = 0;
    let y = 0;
    let n = 0;
    for (let k = -2; k <= 2; k++) {
      const at = Math.min(segment.end - 0.001, Math.max(segment.start, time + k * 0.3));
      const pose = posesAt(this.show, segment, at)[seat];
      if (!pose || pose.state === 'x') continue;
      x += pose.x;
      y += pose.y;
      n += 1;
    }
    return n > 0 ? { x: x / n, y: y / n } : null;
  }

  private clamp(x: number, y: number, zoom: number): { x: number; y: number } {
    const fitAxis = (value: number, size: number, anchor: number, low: number, high: number) => {
      const room = (high - low) / zoom; // 空いている所に入る升目の数
      if (room >= size + 1) return size / 2 + (anchor - (low + high) / 2) / zoom; // 全部入るなら、真ん中に置く
      return Math.min(size + 0.5 - (high - anchor) / zoom, Math.max(-0.5 + (anchor - low) / zoom, value));
    };
    return { x: fitAxis(x, this.cols, ANCHOR_X, PAD.left, W - PAD.right), y: fitAxis(y, this.rows, ANCHOR_Y, PAD.top, H - PAD.bottom) };
  }

  private cameraOf(segment: RoamSegment, shot: Shot, time: number): { x: number; y: number; zoom: number } {
    if (shot.kind === 'overview') {
      const zoom = this.fitZoom();
      return { ...this.clamp(this.cols / 2, this.rows / 2, zoom), zoom };
    }
    if (this.small) {
      const zoom = this.fitZoom();
      return { ...this.clamp(this.cols / 2, this.rows / 2, zoom), zoom };
    }
    if (shot.kind === 'place') {
      const place = shot.at ?? { x: this.cols / 2, y: this.rows / 2 };
      return { ...this.clamp(place.x, place.y, shot.zoom), zoom: shot.zoom };
    }
    // 見どころの場面は、始まってから少しずつ寄る
    let zoom = shot.zoom === ZOOM.follow ? shot.zoom : lerp(ZOOM.follow, shot.zoom, easeInOut((time - shot.start) / 1.8));
    const a = this.smooth(segment, shot.subject, time);
    const b = shot.kind === 'pair' ? this.smooth(segment, shot.other, time) : null;
    let focus = a ?? b ?? { x: this.cols / 2, y: this.rows / 2 };
    if (a && b) {
      // ふたりが離れている時は、ふたりとも空いている所に入るまで引く（1升ずつ余白をとる）。
      // 枠は、ならした位置と今の位置の両方を囲む（床下を速く動く人が、ならした位置より先へ出て、枠の外へ行かないように）
      const now = posesAt(this.show, segment, Math.min(segment.end - 0.001, Math.max(segment.start, time)));
      const points = [a, b, now[shot.subject], now[shot.other]].filter((p): p is NonNullable<typeof p> => !!p && (!('state' in p) || p.state !== 'x'));
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const [left, right, top, bottom] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const fitX = (W - PAD.left - PAD.right) / (right - left + 2);
      const fitY = (H - PAD.top - PAD.bottom) / (bottom - top + 2);
      zoom = Math.max(this.fitZoom(), Math.min(zoom, fitX, fitY));
      focus = { x: (left + right) / 2, y: (top + bottom) / 2 };
    }
    return { ...this.clamp(focus.x, focus.y, zoom), zoom };
  }

  /** マップ全体を映すカメラ（確認用）。 */
  overview(segment: RoamSegment): Camera {
    const shot: Shot = { start: segment.start, end: segment.end, kind: 'overview', subject: 0, other: 0, zoom: this.fitZoom(), why: 'start' };
    return { ...this.cameraOf(segment, shot, segment.start), subject: null, shot, shade: 0, sinceCut: Infinity };
  }

  /** ひとりを追う / ふたりを一緒に映し続けるカメラ（冒頭のダイジェストで、仲よしのやりとりを、カメラの係の切り替えに任せずに見せる）。 */
  focusCamera(segment: RoamSegment, subject: number, other: number | null, time: number): Camera {
    const shot: Shot = { start: segment.start, end: segment.end, kind: other === null ? 'follow' : 'pair', subject, other: other ?? subject, zoom: ZOOM.close, why: 'chat' };
    return { ...this.cameraOf(segment, shot, time), subject, shot, shade: 0, sinceCut: Infinity };
  }

  cameraAt(segment: RoamSegment, time: number, secrets: boolean): Camera {
    const shots = this.shotsFor(segment, secrets);
    const index = Math.max(0, shots.findIndex((s) => time < s.end));
    const shot = (time >= (shots.at(-1) as Shot).end ? shots.at(-1) : shots[index]) as Shot;
    const at = shots.indexOf(shot);
    const now = this.cameraOf(segment, shot, time);
    const subject = shot.kind === 'overview' || shot.kind === 'place' ? null : shot.subject;
    const local = time - shot.start;
    const before = at > 0 ? (shots[at - 1] as Shot) : null;
    if (!before) return { ...now, subject, shot, shade: Math.min(1, local / 0.5), sinceCut: Infinity };

    // 前の場面と近ければ、なめらかにつなぐ。離れていれば、ぱっと切り替える
    const from = this.cameraOf(segment, before, shot.start);
    const to = this.cameraOf(segment, shot, shot.start);
    const near = before.kind === 'overview' || Math.hypot(from.x - to.x, from.y - to.y) < NEAR_TILES;
    const followed = (s: Shot) => s.kind === 'follow' || s.kind === 'pair';
    const sameSubject = followed(before) && followed(shot) && before.subject === shot.subject;
    // つなぎは、その場面のうちに終える（短い場面の次で、絵が飛ばないように）
    const blend = Math.min(before.kind === 'overview' ? 1.7 : BLEND_SECONDS, shot.end - shot.start);
    if (!near) return { ...now, subject, shot, shade: Math.min(1, local / 0.5), sinceCut: local };
    if (local >= blend) return { ...now, subject, shot, shade: 1, sinceCut: Infinity };
    const k = easeInOut(local / blend);
    const was = this.cameraOf(segment, before, time);
    return {
      x: lerp(was.x, now.x, k),
      y: lerp(was.y, now.y, k),
      zoom: Math.exp(lerp(Math.log(was.zoom), Math.log(now.zoom), k)),
      subject,
      shot,
      shade: sameSubject ? 1 : Math.min(1, local / 0.5),
      sinceCut: Infinity,
    };
  }
}
