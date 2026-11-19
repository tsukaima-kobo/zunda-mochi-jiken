// 工房の中を歩き回る時間と、試合全体の流れ（見回り → 集会 → 見回り → …）。
// エージェントは「どの部屋へ行く」「仕込みを進める」「知らせる」などの意図だけを決め、
// 道を探して歩くこと、持ち場で手を動かすこと、近づいて餅に変えることは、ここ（コード）がやる。
//
// この作品での出来事:
// - 従業員は、工房のあちこちの持ち場を回って、自分の仕込みを進める。全員の仕込みが終われば従業員の勝ち。
// - 従業員にまぎれた「ずんだの妖精」は、人をずんだ餅に変えてしまう。乱暴なことは起きない。
//   仕込みはふりだけ。床下の抜け道を通れる。あかりを消す、かまどを焚きすぎる、戸を閉める、の妨害ができる。
// - 「妖精びいき」は、妖精の味方をする人間（人狼の狂人）。誰が妖精かは知らず、妖精も知らない。
//   仕込みはふりだけで、特別な行動は無い。頭数は人間の側に数える。妖精が勝てば勝ち。
// - ずんだ餅になった人を見つけた人は知らせて、集会を開ける。中庭の鐘を鳴らして、みんなを集めることもできる。
// - 集会の投票で選ばれた人は、工房からクビにする。全員に分かるのは、その人が妖精だったかどうかだけ。
// - ずんだ餅になった従業員は、心だけになって自分の仕込みを続ける（起きている人には見えない）。
// - 起きている人間（従業員と妖精びいき）が、妖精の人数以下になれば、妖精の勝ち。
//   かまどの焚きすぎを時間内に直せなかった時と、開店の時刻までに仕込みが終わらなかった時も、妖精の勝ち。
// （内部の名前 nibbler・nap・asleep は、前の題材「つまみ食い犯・おひるね」のなごり。記録の互換のために残している）

import { bondsOf, CAST, NO_TARGET, ROAM_SAY_MAX_CHARS, SABOTAGE_CRISIS, SABOTAGE_LIGHTS } from '../../protocol/src/index.ts';
import type { CastMember, Role, RoamObservation, Side } from '../../protocol/src/index.ts';
import { areaAt, centerOf, findRoute, findRouteThroughDoors, hasLineOfSight, isWalkable, parseMap, tileOf } from './map.ts';
import type { DutyDefinition, FixPoint, GameMap, Hatch, MapDefinition, Point, Station } from './map.ts';
import { createRng } from './rng.ts';
import { castOf, clockText, DEFAULT_MEETING_CONFIG, nameOf, playerById, RuleViolation } from './world.ts';
import type { Ballot, MeetingConfig, MeetingWorld, PlayerId, PlayerTruth } from './world.ts';

// 登場人物は packages/protocol/src/cast.ts。人柄は名前に付いている。
// 席の並べ替えは12の枠で行い、登場人物のいない枠は飛ばす（登場人物の数を変えても、役職の割り当ての乱数の使い方が変わらないように）。
const SLOTS = 12;
const SMALL_CAST = 8;

/** 抜け道の中にいる時の、場所の名前。 */
export const UNDER_FLOOR = '床下の抜け道';

export interface RoamConfig {
  /** 開店までの時間（歩き回る時間の合計、秒）。集会の間は進まない。deadline が 0 の時は、試合が止まらないための上限（ふつうは届かない長さにする）。 */
  roamSeconds: number;
  /**
   * 1: 開店の時刻（制限時間）がある。仕込みが終わらないまま来たら妖精の勝ち。
   * 0: 制限時間は無い（工房のマップは 0）。画面・説明・頭脳への指示から時刻の話を外す。
   */
  deadline: number;
  tickSeconds: number;
  /** 歩く速さ（タイル/秒）。 */
  speed: number;
  /** 見える距離（タイル）。あいだに壁があれば見えない。 */
  visionRadius: number;
  /** ついていく相手を見失ってから、あきらめるまでの秒数。 */
  followLostSeconds: number;
  maxFollowSeconds: number;
  waitSeconds: number;
  /** 次に人をずんだ餅に変えられるまでの秒数。見回りの初めにも、同じだけ待つ。 */
  napCooldown: number;
  /** ずんだ餅に変えられる距離（タイル）。 */
  napRange: number;
  /** 妖精の人数。0 なら人数から決める（9人以上で2人）。 */
  nibblers: number;
  /** 妖精びいきの人数。-1 なら人数から決める（いまは 0。狐に置きかえた）。 */
  madmen: number;
  /** 狐の人数。-1 なら人数から決める（11人以上で1人）。 */
  foxes: number;
  /** 1人が持つ仕込みの数（全員共通の仕込みのほかに）。マップに仕込みの種類があり、dutySteps が 0 より大きい時は使わない。 */
  longDuties: number;
  shortDuties: number;
  /** 1人に配る工程（持ち場）の数。マップの仕込みの種類の割合で分ける（全員共通の仕込みも数に入る）。0 なら longDuties と shortDuties で配る。 */
  dutySteps: number;
  /** 持ち場で手を動かす時間の倍率。 */
  dutyPace: number;
  /** 1人が鐘を鳴らせる回数と、見回りの初めに鐘を鳴らせない秒数。 */
  bellUses: number;
  bellCooldown: number;
  /** 妨害（あかり・かまど）を次にできるまでの秒数。困りごとが片づいた時から数える。見回りの初めは First。 */
  sabotageCooldown: number;
  sabotageFirstCooldown: number;
  /** あかりが消えている間の、従業員の見える距離の倍率。 */
  lightsVision: number;
  /** あかりを直すのにかかる秒数。 */
  fixSeconds: number;
  /** かまどの焚きすぎを直せるまでの猶予（秒）。過ぎると、妖精の勝ち。 */
  crisisSeconds: number;
  /** 戸が閉まっている秒数と、次に戸を閉められるまでの秒数。 */
  doorSeconds: number;
  doorCooldown: number;
  /** 抜け道を通るのにかかる秒数。 */
  sneakSeconds: number;
  /** 声が届く距離（タイル）。0 なら見える距離と同じ。あいだに壁があれば届かない。暗くても届く。 */
  hearRadius: number;
  /** 1人が話してから、次に話せるまでの秒数。 */
  chatGap: number;
}

export const DEFAULT_ROAM_CONFIG: RoamConfig = {
  roamSeconds: 180,
  deadline: 1,
  tickSeconds: 0.2,
  speed: 3,
  visionRadius: 6,
  followLostSeconds: 2,
  maxFollowSeconds: 12,
  waitSeconds: 4,
  napCooldown: 20,
  napRange: 1.5,
  nibblers: 0,
  madmen: -1,
  foxes: -1,
  longDuties: 1,
  shortDuties: 2,
  dutySteps: 0,
  dutyPace: 1,
  bellUses: 1,
  bellCooldown: 15,
  sabotageCooldown: 30,
  sabotageFirstCooldown: 15,
  lightsVision: 0.35,
  fixSeconds: 3,
  crisisSeconds: 45,
  doorSeconds: 10,
  doorCooldown: 25,
  sneakSeconds: 2,
  hearRadius: 0,
  chatGap: 6,
};

/** 見回りの間に1回で話せる長さ（字）。長い分は切る。 */
export const CHAT_MAX_CHARS = ROAM_SAY_MAX_CHARS;

/** doors は、道を決めた時の「戸の開け閉めの番号」。変わっていたら、道を探し直す。 */
type Task =
  | { kind: 'move_to'; room: string; goal: Point; doors: number }
  | { kind: 'follow'; targetId: PlayerId; startedAt: number; lostSince: number | null }
  | { kind: 'nap'; targetId: PlayerId; startedAt: number; lostSince: number | null; onlyIfUnseen: boolean }
  | { kind: 'wait'; until: number }
  /** at は、いま向かっている（している）仕込みと手順の番号。workLeft は、手を動かす残り秒数（歩いている間は null）。 */
  | { kind: 'duty'; want: string | null; at: [number, number] | null; workLeft: number | null; doors: number }
  /** auto: 場所を指定せずに直しに来た（先に人がついた所を避けて、空いている所へ回る） */
  | { kind: 'fix'; point: string; workLeft: number | null; doors: number; auto: boolean }
  | { kind: 'bell'; doors: number }
  /** until は、抜け道から出る時刻（出入口へ歩いている間は null）。 */
  | { kind: 'sneak'; from: string; to: string; until: number | null; doors: number };

export interface DutyStep {
  station: string;
  what: string;
  room: string;
  seconds: number;
  done: boolean;
}

export interface Duty {
  name: string;
  steps: DutyStep[];
}

/** ずんだ餅になった従業員の、心だけの姿。自分の仕込みを続ける。起きている人には見えない。 */
export interface Spirit {
  pos: Point;
  path: Point[];
  at: [number, number] | null;
  workLeft: number | null;
}

export interface Actor {
  id: PlayerId;
  nibbler: boolean;
  /** 妖精びいき。仕込みはふりだけで、特別な行動は無い。 */
  madman: boolean;
  /** 狐。仕込みはふりだけで、特別な行動は無い。 */
  fox: boolean;
  pos: Point;
  /** これから通る点（タイルの中心）。 */
  path: Point[];
  task: Task | null;
  /** 直前の行動の結果。本人にだけ伝える。 */
  lastResult: string | null;
  /** 工房の中にいるか。クビになった人と、休憩室へ運ばれた人は false（集会で全員に分かる）。 */
  onMap: boolean;
  /** 床下の抜け道の中にいる（誰からも見えず、誰も見えない）。 */
  under: boolean;
  /** この刻みに本人が見聞きした出来事。次の刻みで消える。 */
  events: string[];
  /** この刻みに聞こえた声（自分の声も入る）。次の刻みで消える。where は話した人のいた場所（姿が見えなかった時は null）。 */
  heard: { speaker: string; text: string; where: string | null }[];
  /** 次に話せる時刻。 */
  chatReadyAt: number;
  /** 自分の仕込み。妖精と妖精びいきのものは、ふりをするための見せかけ。 */
  duties: Duty[];
  bellUsesLeft: number;
  spirit: Spirit | null;
}

/** 人がずんだ餅に変えられた記録。観戦者とログのためのもので、エージェントには渡さない。 */
export interface Incident {
  t: number;
  round: number;
  byId: PlayerId;
  targetId: PlayerId;
  room: string;
  /** 見ていた人。sawWho が false なら、餅に変わるところだけ見えた。 */
  witnesses: { id: PlayerId; sawWho: boolean }[];
}

/** 餅に変えられた以外の出来事の記録。観戦者とログのためのもので、エージェントには渡さない。 */
export type Happening =
  /** 仕込みの手順が1つ終わった。pretend はふりだけ（進み具合は増えない）。spirit は心だけの姿。 */
  | { type: 'task'; t: number; id: PlayerId; duty: string; what: string; station: string; pretend: boolean; spirit: boolean; done: number; total: number }
  | { type: 'sabotage'; t: number; id: PlayerId; what: 'lights' | 'crisis' | 'door'; room: string | null; seconds: number | null }
  | { type: 'fixed'; t: number; what: 'lights' | 'crisis'; ids: PlayerId[] }
  | { type: 'door_open'; t: number; room: string }
  | { type: 'sneak'; t: number; id: PlayerId; phase: 'in' | 'out'; room: string; hatch: string; witnesses: PlayerId[] }
  | { type: 'bell'; t: number; id: PlayerId }
  /** 近くの人にだけ聞こえる声で話した。heard は聞こえた人（話した本人は入らない）。 */
  | { type: 'chat'; t: number; id: PlayerId; text: string; heard: PlayerId[] };

export type Trouble = { kind: 'lights' } | { kind: 'crisis'; deadline: number; held: Record<string, PlayerId | null> };

export type GameResult = {
  /** 勝った側。狐が起きたまま試合が終わると、狐（stolenFrom は、本来なら勝っていた側）。 */
  winner: Side;
  stolenFrom?: Side;
  /**
   * nibbler_sent_home: 妖精が全員クビになった / tasks_done: 仕込みがぜんぶ終わった / opened: 開店の時刻まで守りきった（仕込みの無いマップ）
   * outnumbered: 起きている人間が足りなくなった / crisis: かまどの焚きすぎを直せなかった / late: 開店の時刻までに仕込みが終わらなかった
   */
  why: 'nibbler_sent_home' | 'tasks_done' | 'opened' | 'outnumbered' | 'crisis' | 'late';
};

export interface RoamWorld extends MeetingWorld {
  map: GameMap;
  roam: RoamConfig;
  tick: number;
  /** 開始からの秒数。集会の間は進まない。 */
  clock: number;
  /** 観測の「この瞬間」を区切る番号。時間が1刻み進むたび、集会が終わるたびに増える。 */
  epoch: number;
  /** 何回目の見回りか（1 始まり）。 */
  round: number;
  stage: 'roam' | 'meeting' | 'over';
  actors: Actor[];
  /** 妖精ごとの、次に人をずんだ餅に変えられる時刻。 */
  napReadyAt: Record<PlayerId, number>;
  /** 従業員の仕込みの手順の、終わった数と全部の数。 */
  taskDone: number;
  taskTotal: number;
  trouble: Trouble | null;
  sabotageReadyAt: number;
  doorReadyAt: number;
  bellReadyAt: number;
  /** 戸が閉まっている部屋。 */
  shut: { room: string; until: number }[];
  /** 戸の開け閉めの番号（開け閉めのたびに増える）。 */
  doorsVersion: number;
  incidents: Incident[];
  happenings: Happening[];
  /** いまの集会で見つかった人と場所（集会の間だけ。鐘で集まった時は null）。 */
  found: { id: PlayerId; room: string } | null;
  result: GameResult | null;
  /** 観戦者とログのための正解。エージェントには渡さない。 */
  truth: { nibblerIds: PlayerId[]; madmanIds: PlayerId[]; foxIds: PlayerId[] };
}

export interface RoamWorldOptions {
  seed: number;
  map: MapDefinition;
  players?: number;
  roam?: Partial<RoamConfig>;
  config?: Partial<MeetingConfig>;
}

/** この人数から、妖精びいきを1人入れる（人数で決める時）。2026-11-18 から狐に置きかえたので、人数では入れない。 */
export const MADMAN_FROM = Infinity;
/** この人数から、狐を1人入れる（人数で決める時）。 */
export const FOX_FROM = 11;

/** クビになった人について、全員に公表する文。妖精だったかどうかだけ。 */
function ejectedVerdict(role: Role): string {
  return role === 'nibbler' ? '妖精だった' : '妖精ではなかった';
}

export function createRoamWorld(options: RoamWorldOptions): RoamWorld {
  const count = options.players ?? 5;
  const map = parseMap(options.map);
  if (count < 3 || count > Math.min(CAST.length, map.def.spawn.length)) {
    throw new Error(`人数は 3〜${Math.min(CAST.length, map.def.spawn.length)} 人にしてください`);
  }
  // 決まりの優先順: 試合ごとの指定 → マップに合わせた決まり → 既定
  const roam = { ...DEFAULT_ROAM_CONFIG, ...map.def.settings, ...options.roam };
  const rng = createRng(options.seed);
  const slots = Array.from({ length: count <= SMALL_CAST ? SMALL_CAST : SLOTS }, (_, i) => i);
  const cast = rng
    .shuffle(slots)
    .filter((i) => i < CAST.length)
    .slice(0, count)
    .map((i) => CAST[i] as CastMember);
  const names = cast.map((member) => member.name);
  rng.shuffle(slots); // 前は、ここで人柄を並べ替えていた（乱数の使い方を変えないため、残してある）
  const ids: PlayerId[] = names.map((_, i) => `p${i + 1}`);
  // 8人までは1人（2人にすると、台本ボットの試合で、妖精が8割以上勝った）
  const wanted = roam.nibblers > 0 ? roam.nibblers : count >= 9 ? 2 : 1;
  const nibblerCount = Math.max(1, Math.min(wanted, Math.floor((count - 1) / 2)));
  const nibblerIds = nibblerCount === 1 ? [rng.pick(ids)] : rng.shuffle(ids).slice(0, nibblerCount);
  // 妖精びいきは、ほかの割り当てを変えないよう、別の乱数で選ぶ
  const madmanCount = Math.max(0, Math.min(roam.madmen >= 0 ? roam.madmen : count >= MADMAN_FROM ? 1 : 0, count - nibblerCount - 2));
  const madmanIds = createRng(options.seed * 131 + 17).shuffle(ids.filter((id) => !nibblerIds.includes(id))).slice(0, madmanCount);
  // 狐も、別の乱数で選ぶ（妖精びいきを選んだ時と、同じ人が選ばれやすいように、同じ乱数を使う）
  const foxCount = Math.max(0, Math.min(roam.foxes >= 0 ? roam.foxes : count >= FOX_FROM ? 1 : 0, count - nibblerCount - madmanCount - 2));
  const foxIds = createRng(options.seed * 131 + 17).shuffle(ids.filter((id) => !nibblerIds.includes(id) && !madmanIds.includes(id))).slice(0, foxCount);
  const players: PlayerTruth[] = ids.map((id, i) => {
    const role: Role = nibblerIds.includes(id) ? 'nibbler' : madmanIds.includes(id) ? 'madman' : foxIds.includes(id) ? 'fox' : 'artisan';
    return { id, name: names[i] as string, role, persona: (cast[i] as CastMember).persona, style: (cast[i] as CastMember).style, bonds: bondsOf(names[i] as string, names), status: 'awake', facts: [] };
  });
  // 名簿の並び（全員が知っている）。役職や作った順では並べない
  const roster = rng.shuffle(ids);
  const spawns = rng.shuffle(map.def.spawn);

  // 仕込みの割り当て。妖精と妖精びいきにも同じ形のものを配る（ふりをするため）
  const dutyRng = createRng(options.seed * 31 + 7);
  const defs = map.def.duties ?? [];
  const stations = new Map((map.def.stations ?? []).map((station) => [station.id, station]));
  const groups = map.def.dutyGroups ?? [];
  const byGroup = roam.dutySteps > 0 && groups.length > 0;
  /** 種類ごとに、工程の数の枠を決め、その種類の長い仕込みを1つ（枠に収まるもの）と、短い仕込みで枠を埋める。 */
  const groupDuties = (): DutyDefinition[] => {
    const chosen = defs.filter((d) => d.kind === 'common');
    const total = groups.reduce((sum, g) => sum + g.share, 0);
    for (const group of groups) {
      let left = Math.round((roam.dutySteps * group.share) / total) - chosen.filter((d) => d.group === group.id).reduce((sum, d) => sum + d.steps.length, 0);
      const longs = dutyRng.shuffle(defs.filter((d) => d.group === group.id && d.kind === 'long' && d.steps.length <= left));
      if (left >= 2 && longs.length > 0) {
        const pick = longs[0] as DutyDefinition;
        chosen.push(pick);
        left -= pick.steps.length;
      }
      for (const pick of dutyRng.shuffle(defs.filter((d) => d.group === group.id && d.kind === 'short'))) {
        if (left <= 0) break;
        chosen.push(pick);
        left -= 1;
      }
    }
    return chosen;
  };
  const dutiesFor = (): Duty[] => {
    const chosen = byGroup
      ? groupDuties()
      : [
          ...defs.filter((d) => d.kind === 'common'),
          ...dutyRng.shuffle(defs.filter((d) => d.kind === 'long')).slice(0, roam.longDuties),
          ...dutyRng.shuffle(defs.filter((d) => d.kind === 'short')).slice(0, roam.shortDuties),
        ];
    return chosen.map((def) => ({
      name: def.name,
      steps: def.steps.map((step) => {
        const station = stations.get(step.station);
        if (!station) throw new Error(`マップに無い持ち場です: ${step.station}`);
        return { station: station.id, what: station.name, room: station.room, seconds: Math.max(1, Math.round(step.seconds * roam.dutyPace)), done: false };
      }),
    }));
  };
  const actors: Actor[] = roster.map((id, i) => {
    const [x, y] = spawns[i] as [number, number];
    return {
      id,
      nibbler: nibblerIds.includes(id),
      madman: madmanIds.includes(id),
      fox: foxIds.includes(id),
      pos: centerOf({ x, y }),
      path: [],
      task: null,
      lastResult: null,
      onMap: true,
      under: false,
      events: [],
      heard: [],
      chatReadyAt: 0,
      duties: dutiesFor(),
      bellUsesLeft: roam.bellUses,
      spirit: null,
    };
  });

  return {
    seed: options.seed,
    config: { ...DEFAULT_MEETING_CONFIG, ...options.config },
    players,
    roster,
    history: [],
    // まだ集会は開かれていない
    meeting: { index: 0, reason: '', reporterId: roster[0] as PlayerId, absent: [], seats: [], round: 1, phase: 'done', queue: [], transcript: [], outcome: null },
    map,
    roam,
    tick: 0,
    clock: 0,
    epoch: 0,
    round: 1,
    stage: 'roam',
    actors,
    napReadyAt: Object.fromEntries(nibblerIds.map((id) => [id, roam.napCooldown])),
    taskDone: 0,
    taskTotal: actors.filter(realWork).reduce((sum, a) => sum + a.duties.reduce((n, duty) => n + duty.steps.length, 0), 0),
    trouble: null,
    sabotageReadyAt: roam.sabotageFirstCooldown,
    doorReadyAt: roam.sabotageFirstCooldown,
    bellReadyAt: roam.bellCooldown,
    shut: [],
    doorsVersion: 0,
    incidents: [],
    happenings: [],
    found: null,
    result: null,
    truth: { nibblerIds, madmanIds, foxIds },
  };
}

export function actorById(world: RoamWorld, id: PlayerId): Actor {
  const actor = world.actors.find((a) => a.id === id);
  if (!actor) throw new Error(`知らないプレイヤー: ${id}`);
  return actor;
}

const isAwake = (world: RoamWorld, id: PlayerId) => playerById(world, id).status === 'awake';

/** 起きている人。並びは名簿順。 */
export function awakeIds(world: RoamWorld): PlayerId[] {
  return world.roster.filter((id) => isAwake(world, id));
}

/** 見える距離。あかりが消えている間、従業員は近くしか見えない。 */
function visionOf(world: RoamWorld, actor: Actor): number {
  return world.roam.visionRadius * (world.trouble?.kind === 'lights' && !actor.nibbler ? world.roam.lightsVision : 1);
}

function canSeePoint(world: RoamWorld, from: Actor, point: Point): boolean {
  if (!from.onMap || from.under) return false;
  return Math.hypot(point.x - from.pos.x, point.y - from.pos.y) <= visionOf(world, from) && hasLineOfSight(world.map, from.pos, point);
}

function canSee(world: RoamWorld, from: Actor, to: Actor): boolean {
  return to.onMap && !to.under && canSeePoint(world, from, to.pos);
}

/** from に、to の声が届くか。あいだに壁が無く、届く距離にいること。暗さは関係ない。 */
function canHear(world: RoamWorld, from: Actor, to: Actor): boolean {
  if (!from.onMap || from.under || !to.onMap || to.under) return false;
  const radius = world.roam.hearRadius > 0 ? world.roam.hearRadius : world.roam.visionRadius;
  return Math.hypot(to.pos.x - from.pos.x, to.pos.y - from.pos.y) <= radius && hasLineOfSight(world.map, from.pos, to.pos);
}

/**
 * 近くの人にだけ聞こえる声で話す。話せなかった時（話す間がまだ来ていない、抜け道の中、見回りの時間でない）は false。
 * 聞こえた人には、その刻みの観測に入る。話した本人にも、自分の声として入る（誰に聞こえたかは伝えない）。
 */
export function speakAloud(world: RoamWorld, id: PlayerId, said: string): boolean {
  const text = [...said.replace(/\s+/g, ' ').trim()].slice(0, CHAT_MAX_CHARS).join('');
  if (text.length === 0 || world.stage !== 'roam' || !isAwake(world, id)) return false;
  const actor = actorById(world, id);
  if (actor.under || !actor.onMap || world.clock < actor.chatReadyAt) return false;
  const speaker = nameOf(world, id);
  actor.chatReadyAt = world.clock + world.roam.chatGap;
  actor.heard.push({ speaker, text, where: areaAt(world.map, actor.pos) });
  const heard: PlayerId[] = [];
  for (const other of awakeIds(world)) {
    if (other === id) continue;
    const listener = actorById(world, other);
    if (!canHear(world, listener, actor)) continue;
    heard.push(other);
    listener.heard.push({ speaker, text, where: canSee(world, listener, actor) ? areaAt(world.map, actor.pos) : null });
  }
  world.happenings.push({ type: 'chat', t: world.clock, id, text, heard });
  return true;
}

/** いま見えている相手（ずんだ餅になった人も含む）。並びは名簿順。 */
export function visibleTo(world: RoamWorld, id: PlayerId): PlayerId[] {
  const me = actorById(world, id);
  return world.roster.filter((other) => other !== id && canSee(world, me, actorById(world, other)));
}

// 種と状況から決まる、乱数の状態を持たない選び方（世界を複製しても結果が変わらないように）
function stableIndex(seed: number, salt: string, length: number): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  for (let i = 0; i < salt.length; i++) {
    h ^= salt.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) % length;
}

/** 同じ刻みに重なった行動の順番。席順や ID 順で有利不利が出ないよう、種と時刻から決める。 */
export function tickOrder(world: RoamWorld, ids: readonly PlayerId[]): PlayerId[] {
  const key = (id: PlayerId) => stableIndex(world.seed, `order:${world.tick}:${world.epoch}:${id}`, 1 << 30);
  return [...ids].sort((a, b) => key(a) - key(b) || world.roster.indexOf(a) - world.roster.indexOf(b));
}

function walk(walker: { pos: Point; path: Point[] }, distance: number): void {
  let remaining = distance;
  while (remaining > 1e-9 && walker.path.length > 0) {
    const next = walker.path[0] as Point;
    const dx = next.x - walker.pos.x;
    const dy = next.y - walker.pos.y;
    const gap = Math.hypot(dx, dy);
    if (gap <= remaining) {
      walker.pos = { ...next };
      walker.path.shift();
      remaining -= gap;
    } else {
      walker.pos = { x: walker.pos.x + (dx / gap) * remaining, y: walker.pos.y + (dy / gap) * remaining };
      remaining = 0;
    }
  }
}

function stop(actor: Actor, result: string): void {
  actor.task = null;
  actor.path = [];
  actor.lastResult = result;
}

const isAt = (pos: Point, tile: Point) => Math.hypot(pos.x - (tile.x + 0.5), pos.y - (tile.y + 0.5)) < 0.05;

/** その升目の中心まで歩く道を決める。道が無ければ false。 */
function routeTo(world: RoamWorld, actor: Actor, tile: Point): boolean {
  const goal = centerOf(tile);
  const path = findRoute(world.map, actor.pos, goal);
  if (!path) return false;
  actor.path = path.length > 0 || isAt(actor.pos, tile) ? path : [goal];
  return true;
}

function stationOf(world: RoamWorld, id: string): Station {
  const station = world.map.def.stations?.find((s) => s.id === id);
  if (!station) throw new Error(`マップに無い持ち場です: ${id}`);
  return station;
}

function fixPointOf(world: RoamWorld, id: string): FixPoint {
  const point = world.map.def.fixPoints?.find((f) => f.id === id);
  if (!point) throw new Error(`マップに無い場所です: ${id}`);
  return point;
}

function hatchOf(world: RoamWorld, id: string): Hatch {
  const hatch = world.map.def.hatches?.find((h) => h.id === id);
  if (!hatch) throw new Error(`マップに無い出入口です: ${id}`);
  return hatch;
}

/** 次に進める手順（仕込みの番号と手順の番号）。want があればその仕込み、無ければいちばん近い持ち場のもの。 */
function chooseStep(world: RoamWorld, duties: Duty[], pos: Point, want: string | null): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDistance = Infinity;
  duties.forEach((duty, d) => {
    const s = duty.steps.findIndex((step) => !step.done);
    if (s < 0 || (want !== null && duty.name !== want)) return;
    const station = stationOf(world, (duty.steps[s] as DutyStep).station);
    const distance = Math.hypot(station.x + 0.5 - pos.x, station.y + 0.5 - pos.y);
    if (distance < bestDistance) {
      best = [d, s];
      bestDistance = distance;
    }
  });
  return best;
}

const stepAt = (duties: Duty[], at: [number, number]) => ((duties[at[0]] as Duty).steps[at[1]] as DutyStep);

/** 持ち場で手を動かしている（仕込み、ふり、直す作業）。そばで見れば分かる。 */
export function isWorking(actor: Actor): boolean {
  const task = actor.task;
  return (task?.kind === 'duty' || task?.kind === 'fix') && task.workLeft !== null;
}

/** 従業員だけが、本当に仕込みを進める（妖精・妖精びいき・狐は、ふりだけ）。 */
export function realWork(actor: Actor): boolean {
  return !actor.nibbler && !actor.madman && !actor.fox;
}

/** 記録のための、1文字の状態。a: 起きている / w: 持ち場で手を動かしている / u: 抜け道の中 / z: ずんだ餅になっている / x: 工房にいない */
export function actorMark(world: RoamWorld, actor: Actor): string {
  if (!actor.onMap) return 'x';
  if (playerById(world, actor.id).status !== 'awake') return 'z';
  if (actor.under) return 'u';
  return isWorking(actor) ? 'w' : 'a';
}

/** 手順が1つ終わった。従業員の分だけ、工房全体の進み具合が増える。 */
function completeStep(world: RoamWorld, actor: Actor, at: [number, number], spirit: boolean): void {
  const duty = actor.duties[at[0]] as Duty;
  const step = stepAt(actor.duties, at);
  step.done = true;
  if (realWork(actor)) world.taskDone += 1;
  world.happenings.push({
    type: 'task',
    t: world.clock,
    id: actor.id,
    duty: duty.name,
    what: step.what,
    station: step.station,
    pretend: !realWork(actor),
    spirit,
    done: world.taskDone,
    total: world.taskTotal,
  });
}

/** 起きている人間（従業員・妖精びいき・狐）が、起きている妖精の人数以下になったら、妖精の勝ち。 */
function decideWinner(world: RoamWorld): GameResult | null {
  const awake = world.players.filter((p) => p.status === 'awake');
  const nibblers = awake.filter((p) => p.role === 'nibbler').length;
  const humans = awake.length - nibblers;
  if (nibblers === 0) return { winner: 'artisan', why: 'nibbler_sent_home' };
  if (humans <= nibblers) return { winner: 'nibbler', why: 'outnumbered' };
  if (world.taskTotal > 0 && world.taskDone >= world.taskTotal) return { winner: 'artisan', why: 'tasks_done' };
  return null;
}

function finish(world: RoamWorld, result: GameResult): void {
  // 狐が起きたまま試合が終われば、どちらが勝っても、狐が勝ちを横取りする
  const fox = world.players.some((p) => p.role === 'fox' && p.status === 'awake');
  world.result = fox && result.winner !== 'fox' ? { ...result, winner: 'fox', stolenFrom: result.winner } : result;
  world.stage = 'over';
  for (const actor of world.actors) {
    actor.task = null;
    actor.path = [];
  }
}

function tellAwake(world: RoamWorld, text: string): void {
  for (const id of awakeIds(world)) actorById(world, id).events.push(text);
}

/** 人をずんだ餅に変える。見ていた人には、見えた範囲のことだけを伝える。 */
function giveNapMochi(world: RoamWorld, actor: Actor, target: Actor): void {
  const byName = nameOf(world, actor.id);
  const targetName = nameOf(world, target.id);
  const room = areaAt(world.map, target.pos);
  const witnesses: Incident['witnesses'] = [];
  for (const id of awakeIds(world)) {
    if (id === actor.id || id === target.id) continue;
    const watcher = actorById(world, id);
    if (!canSee(world, watcher, target)) continue;
    const sawWho = canSee(world, watcher, actor);
    witnesses.push({ id, sawWho });
    watcher.events.push(
      sawWho
        ? `${room} で ${byName} が ${targetName} に手をかざし、${targetName} がずんだ餅に変わるのを見た`
        : `${room} で ${targetName} が急にずんだ餅に変わるのを見た（そばに誰がいたかは見えなかった）`,
    );
  }
  playerById(world, target.id).status = 'asleep';
  target.task = null;
  target.path = [];
  // ずんだ餅になった従業員は、心だけになって自分の仕込みを続ける
  if (realWork(target)) target.spirit = { pos: { ...target.pos }, path: [], at: null, workLeft: null };
  stop(actor, `${targetName} をずんだ餅に変えた`);
  world.napReadyAt[actor.id] = world.clock + world.roam.napCooldown;
  world.incidents.push({ t: world.clock, round: world.round, byId: actor.id, targetId: target.id, room, witnesses });
}

// ───────── 戸 ─────────

function refreshDoors(world: RoamWorld): void {
  world.map.closed = [...new Set(world.shut.flatMap((s) => world.map.doorTiles[s.room] ?? []))];
  world.doorsVersion += 1;
}

/** その部屋の戸が閉まっていると分かるか（その部屋にいるか、閉まった戸が見えている）。 */
function noticesShut(world: RoamWorld, actor: Actor, room: string): boolean {
  if (actor.under || !actor.onMap) return false;
  if (areaAt(world.map, actor.pos) === room) return true;
  const tiles = world.map.doorTiles[room] ?? [];
  // 戸そのものは見通しをさえぎるので、その戸だけ無いものとして確かめる
  const closed = world.map.closed;
  world.map.closed = closed.filter((tile) => !tiles.includes(tile));
  try {
    return tiles.some((tile) => canSeePoint(world, actor, centerOf({ x: tile % world.map.width, y: Math.floor(tile / world.map.width) })));
  } finally {
    world.map.closed = closed;
  }
}

function shutDoors(world: RoamWorld, room: string): void {
  world.shut.push({ room, until: world.clock + world.roam.doorSeconds });
  refreshDoors(world);
  // 戸口に立っていた人は、となりの升目へよける
  for (const id of awakeIds(world)) {
    const actor = actorById(world, id);
    const tile = tileOf(actor.pos);
    if (actor.under || isWalkable(world.map, tile.x, tile.y)) continue;
    const spots: Point[] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (isWalkable(world.map, tile.x + dx, tile.y + dy)) spots.push(centerOf({ x: tile.x + dx, y: tile.y + dy }));
    spots.sort((a, b) => Math.hypot(a.x - actor.pos.x, a.y - actor.pos.y) - Math.hypot(b.x - actor.pos.x, b.y - actor.pos.y));
    if (spots[0]) actor.pos = spots[0];
    actor.path = [];
  }
  for (const id of awakeIds(world)) {
    const actor = actorById(world, id);
    if (noticesShut(world, actor, room)) actor.events.push(`${room} の戸が閉まった`);
  }
}

// ───────── 困りごと（あかり・かまど） ─────────

function troubleFixPoints(world: RoamWorld, kind: 'lights' | 'crisis'): FixPoint[] {
  return (world.map.def.fixPoints ?? []).filter((point) => point.for === kind);
}

function describeTrouble(world: RoamWorld, kind: 'lights' | 'crisis'): string {
  const places = troubleFixPoints(world, kind).map((point) => `${point.room} の「${point.name}」`);
  return kind === 'lights'
    ? `工房のあかりが消えた。${places.join('か')}で直せる`
    : `かまどが焚かれすぎている！ ${world.roam.crisisSeconds}秒のうちに、${places.join('と')}に、同時に人がつかないといけない`;
}

function resolveTrouble(world: RoamWorld, ids: PlayerId[]): void {
  const trouble = world.trouble;
  if (!trouble) return;
  world.trouble = null;
  world.sabotageReadyAt = world.clock + world.roam.sabotageCooldown;
  world.happenings.push({ type: 'fixed', t: world.clock, what: trouble.kind, ids });
  tellAwake(world, trouble.kind === 'lights' ? '工房のあかりがついた' : 'かまどの火が落ち着いた');
  for (const id of ids) stop(actorById(world, id), trouble.kind === 'lights' ? 'あかりを直した' : 'かまどを落ち着かせた');
}

/** 鐘を鳴らせない理由（鳴らせるなら null）。本人のことと、全員に分かることだけから作る。 */
function bellProblem(world: RoamWorld, actor: Actor): string | null {
  if (!world.map.def.bell) return 'この工房に鐘はない';
  if (actor.bellUsesLeft <= 0) return '自分はもう鐘を鳴らせない';
  if (world.trouble) return '困りごとが片づくまで、鐘は鳴らせない';
  if (world.clock < world.bellReadyAt) return `鐘は、あと${Math.ceil(world.bellReadyAt - world.clock)}秒鳴らせない`;
  return null;
}

/** 抜け道の出入りを、見えていた人に伝える。 */
function noteSneak(world: RoamWorld, actor: Actor, hatch: Hatch, phase: 'in' | 'out'): void {
  const name = nameOf(world, actor.id);
  const witnesses: PlayerId[] = [];
  for (const id of awakeIds(world)) {
    if (id === actor.id) continue;
    const watcher = actorById(world, id);
    if (!canSeePoint(world, watcher, centerOf(hatch))) continue;
    witnesses.push(id);
    watcher.events.push(phase === 'in' ? `${name} が ${hatch.room} の床下の抜け道に入っていくのを見た` : `${name} が ${hatch.room} の床下の抜け道から出てくるのを見た`);
  }
  world.happenings.push({ type: 'sneak', t: world.clock, id: actor.id, phase, room: hatch.room, hatch: hatch.id, witnesses });
}

/** 心だけの姿が、仕込みを続ける。閉まった戸は関係ない。 */
function stepSpirit(world: RoamWorld, actor: Actor): void {
  const spirit = actor.spirit as Spirit;
  if (spirit.at === null) {
    spirit.at = chooseStep(world, actor.duties, spirit.pos, null);
    if (spirit.at === null) return;
    const station = stationOf(world, stepAt(actor.duties, spirit.at).station);
    spirit.path = findRouteThroughDoors(world.map, spirit.pos, centerOf(station)) ?? [centerOf(station)];
    if (spirit.path.length === 0 && !isAt(spirit.pos, station)) spirit.path = [centerOf(station)];
    spirit.workLeft = null;
  }
  const step = stepAt(actor.duties, spirit.at);
  if (spirit.workLeft === null) {
    walk(spirit, world.roam.speed * world.roam.tickSeconds);
    if (spirit.path.length === 0) spirit.workLeft = step.seconds;
    return;
  }
  spirit.workLeft -= world.roam.tickSeconds;
  if (spirit.workLeft > 1e-9) return;
  completeStep(world, actor, spirit.at, true);
  spirit.at = null;
  spirit.workLeft = null;
}

/** 時間を1刻み進める。 */
export function stepRoam(world: RoamWorld): void {
  if (world.stage !== 'roam') return;
  world.tick += 1;
  world.epoch += 1;
  world.clock = Math.round(world.tick * world.roam.tickSeconds * 1000) / 1000;
  const { roam, clock, map } = world;
  for (const actor of world.actors) {
    actor.events = [];
    actor.heard = [];
  }

  // 時間の来た戸が開く
  const opening = world.shut.filter((s) => clock >= s.until);
  if (opening.length > 0) {
    world.shut = world.shut.filter((s) => clock < s.until);
    refreshDoors(world);
    for (const s of opening) world.happenings.push({ type: 'door_open', t: clock, room: s.room });
  }

  const active = awakeIds(world);
  for (const id of active) {
    const actor = actorById(world, id);
    const task = actor.task;

    // 抜け道の中: 時間が来たら、行き先の出入口から出る
    if (task?.kind === 'sneak' && task.until !== null) {
      if (clock < task.until) continue;
      const exit = hatchOf(world, task.to);
      actor.pos = centerOf(exit);
      actor.under = false;
      noteSneak(world, actor, exit, 'out');
      stop(actor, `抜け道を通って、${exit.room} に出た`);
      continue;
    }

    // ── 歩く前: 行き先と道を決める ──
    if (task?.kind === 'follow' || task?.kind === 'nap') {
      const target = actorById(world, task.targetId);
      const targetName = nameOf(world, task.targetId);
      if (canSee(world, actor, target)) {
        task.lostSince = null;
        if (!isAwake(world, task.targetId)) {
          // 見えている相手が餅になっているなら、ついていく意味がない（見えていない相手の様子は、ここでは使わない）
          stop(actor, `${targetName} はずんだ餅になっている`);
          continue;
        }
        const reach = task.kind === 'nap' ? roam.napRange * 0.8 : 1.5;
        const near = Math.hypot(target.pos.x - actor.pos.x, target.pos.y - actor.pos.y) <= reach;
        actor.path = near ? [] : (findRoute(map, actor.pos, target.pos) ?? []);
      } else {
        task.lostSince ??= clock;
      }
      if (task.lostSince !== null && clock - task.lostSince >= roam.followLostSeconds) {
        stop(actor, `${targetName} を見失った`);
      } else if (clock - task.startedAt >= roam.maxFollowSeconds) {
        stop(actor, task.kind === 'nap' ? `${targetName} をずんだ餅に変える機会がなかった` : `${targetName} についていくのをやめた`);
      }
    } else if (task?.kind === 'move_to') {
      if (task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        if (!routeTo(world, actor, tileOf(task.goal))) stop(actor, `戸が閉まっていて、${task.room} へ行けない`);
      }
    } else if (task?.kind === 'duty') {
      if (task.at === null) {
        task.at = chooseStep(world, actor.duties, actor.pos, task.want) ?? chooseStep(world, actor.duties, actor.pos, null);
        task.workLeft = null;
        task.doors = -1;
        if (task.at === null) stop(actor, '自分の仕込みは、ぜんぶ終わった');
      }
      if (task.at !== null && task.workLeft === null && task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        const station = stationOf(world, stepAt(actor.duties, task.at).station);
        if (!routeTo(world, actor, station)) stop(actor, `戸が閉まっていて、${station.room} の持ち場へ行けない`);
      }
    } else if (task?.kind === 'fix') {
      const point = fixPointOf(world, task.point);
      if (world.trouble?.kind !== point.for) {
        stop(actor, '困りごとは、もう片づいていた');
      } else if (task.workLeft === null && task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        if (!routeTo(world, actor, point)) stop(actor, `戸が閉まっていて、${point.room} へ行けない`);
      }
    } else if (task?.kind === 'bell') {
      if (task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        if (!routeTo(world, actor, map.def.bell as Point)) stop(actor, '戸が閉まっていて、中庭の鐘へ行けない');
      }
    } else if (task?.kind === 'sneak') {
      if (task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        const entry = hatchOf(world, task.from);
        if (!routeTo(world, actor, entry)) stop(actor, `戸が閉まっていて、${entry.room} の出入口へ行けない`);
      }
    }

    walk(actor, roam.speed * roam.tickSeconds);

    // ── 歩いたあと: 着いたか、手を動かし終えたか ──
    const now = actor.task;
    if (now === null || actor.path.length > 0) continue;
    if (now.kind === 'move_to') {
      stop(actor, `${now.room} に着いた`);
    } else if (now.kind === 'wait') {
      if (clock >= now.until) stop(actor, 'しばらく待った');
    } else if (now.kind === 'duty' && now.at !== null) {
      const step = stepAt(actor.duties, now.at);
      if (now.workLeft === null) {
        if (isAt(actor.pos, stationOf(world, step.station))) now.workLeft = step.seconds;
      } else {
        now.workLeft -= roam.tickSeconds;
        if (now.workLeft <= 1e-9) {
          completeStep(world, actor, now.at, false);
          // 頼まれた仕込みが終わったら、あとは近いものから
          if (now.want !== null && !(actor.duties[now.at[0]] as Duty).steps.some((s) => !s.done)) now.want = null;
          now.at = null;
          now.workLeft = null;
        }
      }
    } else if (now.kind === 'fix') {
      const point = fixPointOf(world, now.point);
      if (now.workLeft === null) {
        if (isAt(actor.pos, point)) now.workLeft = point.for === 'lights' ? roam.fixSeconds : 0;
      } else if (point.for === 'lights') {
        now.workLeft -= roam.tickSeconds;
        if (now.workLeft <= 1e-9) resolveTrouble(world, [actor.id]);
      }
    } else if (now.kind === 'bell') {
      if (!isAt(actor.pos, map.def.bell as Point)) continue;
      const problem = bellProblem(world, actor);
      if (problem) {
        stop(actor, `鐘を鳴らせなかった: ${problem}`);
        continue;
      }
      actor.bellUsesLeft -= 1;
      actor.lastResult = null;
      world.happenings.push({ type: 'bell', t: clock, id: actor.id });
      startMeeting(world, actor.id, null);
      return;
    } else if (now.kind === 'sneak') {
      const entry = hatchOf(world, now.from);
      if (!isAt(actor.pos, entry)) continue;
      noteSneak(world, actor, entry, 'in');
      actor.under = true;
      now.until = clock + roam.sneakSeconds;
    }
  }

  // かまどの焚きすぎ: 直す場所の全部に、同時に人がついていれば落ち着く
  if (world.trouble?.kind === 'crisis') {
    const held: Record<string, PlayerId | null> = {};
    for (const point of troubleFixPoints(world, 'crisis')) {
      const holder = active.find((id) => {
        const actor = actorById(world, id);
        return actor.task?.kind === 'fix' && actor.task.point === point.id && actor.task.workLeft !== null;
      });
      held[point.id] = holder ?? null;
    }
    // 場所を指定せずに直しに来た人は、先に人がついた所を避けて、空いている所へ回る
    // （どこに人がついているかは、全員の観測に出ている）
    for (const id of active) {
      const actor = actorById(world, id);
      const task = actor.task;
      if (task?.kind !== 'fix' || !task.auto) continue;
      const holder = held[task.point] ?? null;
      if (holder === null || holder === id) continue;
      const distance = (point: FixPoint) => Math.hypot(point.x + 0.5 - actor.pos.x, point.y + 0.5 - actor.pos.y);
      const free = troubleFixPoints(world, 'crisis').filter((point) => held[point.id] === null).sort((a, b) => distance(a) - distance(b))[0];
      if (!free) continue;
      actor.task = { kind: 'fix', point: free.id, workLeft: null, doors: -1, auto: true };
      actor.path = [];
    }
    world.trouble.held = held;
    const holders = Object.values(held);
    if (holders.length > 0 && holders.every((id) => id !== null)) resolveTrouble(world, holders as PlayerId[]);
  }

  // 心だけになって仕込みを続ける人たち
  for (const actor of world.actors) {
    if (actor.spirit && playerById(world, actor.id).status === 'asleep') stepSpirit(world, actor);
  }

  // 全員が動いたあとで、ずんだ餅に変えられるかを確かめる
  for (const id of tickOrder(world, active)) {
    const actor = actorById(world, id);
    const task = actor.task;
    if (task?.kind !== 'nap' || !isAwake(world, id) || !isAwake(world, task.targetId)) continue;
    const target = actorById(world, task.targetId);
    const inReach = canSee(world, actor, target) && Math.hypot(target.pos.x - actor.pos.x, target.pos.y - actor.pos.y) <= roam.napRange;
    if (!inReach || clock < (world.napReadyAt[id] ?? Infinity)) continue;
    if (task.onlyIfUnseen) {
      // 仲間に見られているのは、かまわない
      const watched = active.some((other) => {
        const watcher = actorById(world, other);
        return other !== id && other !== task.targetId && !watcher.nibbler && isAwake(world, other) && canSee(world, watcher, actor);
      });
      if (watched) continue;
    }
    giveNapMochi(world, actor, target);
    const result = decideWinner(world);
    if (result) return finish(world, result);
  }

  if (world.taskTotal > 0 && world.taskDone >= world.taskTotal) return finish(world, { winner: 'artisan', why: 'tasks_done' });
  if (world.trouble?.kind === 'crisis' && clock >= world.trouble.deadline) return finish(world, { winner: 'nibbler', why: 'crisis' });
  // 開店の時刻。仕込みのあるマップでは「間に合わなかった」、無いマップでは「守りきった」
  if (clock >= roam.roamSeconds) finish(world, world.taskTotal > 0 ? { winner: 'nibbler', why: 'late' } : { winner: 'artisan', why: 'opened' });
}

/**
 * 集会を開く。出席するのは起きている人だけ。来ていない人は、出席を見れば全員に分かる。
 * foundId は見つかった、ずんだ餅になった人。鐘で集めた時は null。
 */
export function startMeeting(world: RoamWorld, reporterId: PlayerId, foundId: PlayerId | null): void {
  if (world.stage !== 'roam') throw new RuleViolation('not_roaming', 'いまは歩き回る時間ではありません');
  const seats = awakeIds(world);
  const reporter = nameOf(world, reporterId);
  if (foundId) {
    const room = areaAt(world.map, actorById(world, foundId).pos);
    world.found = { id: foundId, room };
  } else {
    world.found = null;
  }
  world.meeting = {
    index: world.meeting.index + 1,
    reason: world.found
      ? `${reporter} が ${world.found.room} で、ずんだ餅になった ${nameOf(world, world.found.id)} を見つけて、鐘を鳴らした`
      : `${reporter} が中庭の鐘を鳴らして、みんなを集めた`,
    reporterId,
    absent: world.roster.flatMap((id) => {
      const status = playerById(world, id).status;
      return status === 'awake' ? [] : [{ id, status }];
    }),
    seats,
    round: 1,
    phase: 'speak',
    // 第1巡は知らせた人から。残りは名簿順
    queue: [reporterId, ...seats.filter((id) => id !== reporterId)],
    transcript: [],
    outcome: null,
  };
  world.stage = 'meeting';
  // 集会のあいだに、困りごとは片づき、戸は開く
  world.trouble = null;
  if (world.shut.length > 0) {
    world.shut = [];
    refreshDoors(world);
  }
  for (const actor of world.actors) {
    actor.task = null;
    actor.path = [];
    actor.under = false;
  }
}

/**
 * 集会の結果を世界に反映する。選ばれた人はクビになり、ずんだ餅になった人は休憩室へ運ばれる。
 * 勝敗が決まらなければ、次の見回りを始める。
 */
export function endMeeting(world: RoamWorld): void {
  const { meeting } = world;
  if (world.stage !== 'meeting' || meeting.phase !== 'done' || !meeting.outcome) throw new Error('集会はまだ終わっていません');
  const { outcome } = meeting;
  if (outcome.ejectedId) {
    playerById(world, outcome.ejectedId).status = 'sent_home';
    const gone = actorById(world, outcome.ejectedId);
    gone.onMap = false;
    // クビになった従業員の、残りの仕込みは数えない
    if (realWork(gone)) world.taskTotal -= gone.duties.reduce((n, duty) => n + duty.steps.filter((step) => !step.done).length, 0);
  }
  for (const actor of world.actors) {
    if (playerById(world, actor.id).status === 'asleep') actor.onMap = false;
  }

  // 全員に公開された内容だけで、経過を1行にまとめる（誰が誰に入れたかも、投票のあとで全員に明かされている）
  // クビになった人については、妖精だったかどうかだけを公表する（妖精びいきかどうかは伝えない）
  const asleep = meeting.absent.filter((a) => a.status === 'asleep').map((a) => nameOf(world, a.id));
  const ballotName = (ballot: Ballot) => (ballot === 'skip' ? 'スキップ' : nameOf(world, ballot));
  const tally = outcome.tally.map((row) => `${ballotName(row.target)} ${row.count}票`).join('、');
  const who = outcome.ballots ? meeting.seats.map((id) => `${nameOf(world, id)}→${ballotName(outcome.ballots?.[id] ?? 'skip')}`).join('、') : null;
  world.history.push(
    `集会${meeting.index}（${clockText(world.clock)}）: ${meeting.reason}。ずんだ餅になった人: ${asleep.length > 0 ? asleep.join('、') : 'なし'}。` +
      `投票は ${tally}${who ? `（${who}）` : ''}。${outcome.ejectedId ? `${nameOf(world, outcome.ejectedId)} をクビにした（${ejectedVerdict(playerById(world, outcome.ejectedId).role)}）` : '誰もクビにならなかった'}。`,
  );
  world.found = null;

  const result = decideWinner(world);
  if (result) return finish(world, result);

  world.stage = 'roam';
  world.round += 1;
  world.epoch += 1;
  const spawns = createRng(world.seed * 7919 + world.round).shuffle(world.map.def.spawn);
  awakeIds(world).forEach((id, i) => {
    const actor = actorById(world, id);
    const [x, y] = spawns[i] as [number, number];
    actor.pos = centerOf({ x, y });
    actor.path = [];
    actor.task = null;
    actor.lastResult = null;
    actor.events = [];
    actor.heard = [];
  });
  for (const id of Object.keys(world.napReadyAt)) world.napReadyAt[id] = world.clock + world.roam.napCooldown;
  world.sabotageReadyAt = world.clock + world.roam.sabotageFirstCooldown;
  world.doorReadyAt = world.clock + world.roam.sabotageFirstCooldown;
  world.bellReadyAt = world.clock + world.roam.bellCooldown;
}

/**
 * エージェントの意図を適用する。適用の時点の状況でもう一度確かめる
 * （意図を決めた時から状況が変わっているかもしれないため）。
 * 断る理由の文は、本人の入力と、本人に見えているものだけから作る。
 */
export function applyRoamIntent(world: RoamWorld, id: PlayerId, intent: { action: string; target: string }): void {
  if (world.stage !== 'roam') throw new RuleViolation('not_roaming', 'いまは歩き回る時間ではありません');
  if (!isAwake(world, id)) throw new RuleViolation('not_active', 'いまは動けません');
  const actor = actorById(world, id);
  const { action, target } = intent;
  const seen = (name: string) => visibleTo(world, id).find((other) => nameOf(world, other) === name);
  const nibblerOnly = action === 'transform' || action === 'transform_if_unseen' || action === 'sneak' || action === 'sabotage';
  // 妖精でない人には、知らない行動と同じ断り方をする
  if (nibblerOnly && !actor.nibbler) throw new RuleViolation('unknown_action', 'その行動はできません');
  if (actor.under) throw new RuleViolation('under', '抜け道の中では、ほかのことはできません');

  if (action === 'move_to') {
    const tiles = world.map.roomTiles[target];
    if (!tiles) throw new RuleViolation('unknown_room', 'その名前の部屋はありません');
    const goal = centerOf(tiles[stableIndex(world.seed, `${id}:${world.tick}`, tiles.length)] as Point);
    const path = findRoute(world.map, actor.pos, goal);
    if (!path) throw new RuleViolation('no_path', 'いまは、そこへ行く道がありません');
    actor.task = { kind: 'move_to', room: target, goal, doors: world.doorsVersion };
    actor.path = path;
  } else if (action === 'follow' || action === 'transform' || action === 'transform_if_unseen') {
    const targetId = seen(target);
    if (!targetId) throw new RuleViolation('not_visible', 'その相手は、いま見えていません');
    if (!isAwake(world, targetId)) throw new RuleViolation('asleep', 'その相手は、もうずんだ餅になっています');
    if (action !== 'follow' && actorById(world, targetId).nibbler) throw new RuleViolation('ally', '仲間は餅に変えられません');
    actor.task =
      action === 'follow'
        ? { kind: 'follow', targetId, startedAt: world.clock, lostSince: null }
        : { kind: 'nap', targetId, startedAt: world.clock, lostSince: null, onlyIfUnseen: action === 'transform_if_unseen' };
  } else if (action === 'report') {
    const targetId = seen(target);
    if (!targetId || isAwake(world, targetId)) throw new RuleViolation('nothing_to_report', 'ずんだ餅になったその人が、いま見えていません');
    actor.lastResult = null;
    startMeeting(world, id, targetId);
    return;
  } else if (action === 'wait') {
    actor.task = { kind: 'wait', until: world.clock + world.roam.waitSeconds };
    actor.path = [];
  } else if (action === 'do_task') {
    const open = actor.duties.filter((duty) => duty.steps.some((step) => !step.done));
    if (open.length === 0) throw new RuleViolation('no_duty', '自分の仕込みは、もう残っていません');
    // 名前が合わない時（もう終わった仕込みなど）は、近い持ち場のものから進める
    const want = open.some((duty) => duty.name === target) ? target : null;
    const current = actor.task;
    if (current?.kind === 'duty') {
      // もう仕込みの途中なら、手を止めずに続ける。別の仕込みを頼まれた時だけ、歩いている途中なら行き先を変える
      current.want = want;
      if (want !== null && current.at !== null && current.workLeft === null && (actor.duties[current.at[0]] as Duty).name !== want) current.at = null;
    } else {
      actor.task = { kind: 'duty', want, at: null, workLeft: null, doors: -1 };
      actor.path = [];
    }
  } else if (action === 'fix') {
    const trouble = world.trouble;
    if (!trouble) throw new RuleViolation('no_trouble', 'いま、直すものはありません');
    const points = troubleFixPoints(world, trouble.kind);
    const distance = (point: FixPoint) => Math.hypot(point.x + 0.5 - actor.pos.x, point.y + 0.5 - actor.pos.y);
    // 場所の指定が無ければ、まだ誰もついていない所のうち、近い方へ
    const free = trouble.kind === 'crisis' ? points.filter((point) => (trouble.held[point.id] ?? null) === null || trouble.held[point.id] === id) : points;
    const named = points.find((p) => p.name === target);
    const point = named ?? [...(free.length > 0 ? free : points)].sort((a, b) => distance(a) - distance(b))[0];
    if (!point) throw new RuleViolation('unknown_place', 'この工房では、直せません');
    const current = actor.task;
    if (current?.kind === 'fix' && current.point === point.id) {
      current.auto = !named;
    } else {
      actor.task = { kind: 'fix', point: point.id, workLeft: null, doors: -1, auto: !named };
      actor.path = [];
    }
  } else if (action === 'call_meeting') {
    const problem = bellProblem(world, actor);
    if (problem) throw new RuleViolation('bell', problem);
    actor.task = { kind: 'bell', doors: -1 };
    actor.path = [];
  } else if (action === 'sneak') {
    const hatches = world.map.def.hatches ?? [];
    const exit = hatches.find((hatch) => hatch.room === target);
    if (!exit) throw new RuleViolation('no_hatch', 'その部屋に、抜け道の出入口はありません');
    // 同じ組の出入口のうち、いちばん近い所から入る
    const entries = hatches
      .filter((hatch) => hatch.group === exit.group && hatch.id !== exit.id)
      .map((hatch) => ({ hatch, steps: findRoute(world.map, actor.pos, centerOf(hatch)) }))
      .filter((entry) => entry.steps !== null)
      .sort((a, b) => Math.hypot(a.hatch.x + 0.5 - actor.pos.x, a.hatch.y + 0.5 - actor.pos.y) - Math.hypot(b.hatch.x + 0.5 - actor.pos.x, b.hatch.y + 0.5 - actor.pos.y));
    const entry = entries[0];
    if (!entry) throw new RuleViolation('no_path', 'いまは、入れる出入口がありません');
    actor.task = { kind: 'sneak', from: entry.hatch.id, to: exit.id, until: null, doors: -1 };
    actor.path = [];
  } else if (action === 'sabotage') {
    // 妨害は離れた所からできる。いましている行動は、そのまま続く
    const wait = (until: number) => Math.ceil(until - world.clock);
    if (target === SABOTAGE_LIGHTS || target === SABOTAGE_CRISIS) {
      const kind = target === SABOTAGE_LIGHTS ? 'lights' : 'crisis';
      const points = troubleFixPoints(world, kind);
      if (points.length === 0) throw new RuleViolation('unknown_sabotage', 'この工房では、その妨害はできません');
      if (world.trouble) throw new RuleViolation('trouble_active', 'いまの困りごとが片づくまで、次の妨害はできません');
      if (world.clock < world.sabotageReadyAt) throw new RuleViolation('cooldown', `妨害は、あと${wait(world.sabotageReadyAt)}秒できません`);
      world.trouble = kind === 'lights' ? { kind } : { kind, deadline: world.clock + world.roam.crisisSeconds, held: Object.fromEntries(points.map((p) => [p.id, null])) };
      world.happenings.push({ type: 'sabotage', t: world.clock, id, what: kind, room: null, seconds: kind === 'crisis' ? world.roam.crisisSeconds : null });
      tellAwake(world, describeTrouble(world, kind));
      actor.lastResult = kind === 'lights' ? '工房のあかりを消した' : 'かまどを焚きすぎにした';
    } else {
      if (!world.map.doorTiles[target]) throw new RuleViolation('unknown_sabotage', 'その部屋の戸は閉められません');
      if (world.shut.some((s) => s.room === target)) throw new RuleViolation('already_shut', 'その部屋の戸は、もう閉まっています');
      if (world.clock < world.doorReadyAt) throw new RuleViolation('cooldown', `戸は、あと${wait(world.doorReadyAt)}秒閉められません`);
      world.doorReadyAt = world.clock + world.roam.doorCooldown;
      world.happenings.push({ type: 'sabotage', t: world.clock, id, what: 'door', room: target, seconds: world.roam.doorSeconds });
      shutDoors(world, target);
      actor.lastResult = `${target} の戸を閉めた（${world.roam.doorSeconds}秒で開く）`;
    }
    return;
  } else {
    throw new RuleViolation('unknown_action', 'その行動はできません');
  }
  actor.lastResult = null;
}

function describeTask(world: RoamWorld, actor: Actor): string {
  const task = actor.task;
  if (!task) return '何もしていない';
  if (task.kind === 'move_to') return `${task.room} へ向かっている`;
  if (task.kind === 'follow') return `${nameOf(world, task.targetId)} についていっている`;
  if (task.kind === 'nap') {
    return `${nameOf(world, task.targetId)} に近づいて、ずんだ餅に変えようとしている${task.onlyIfUnseen ? '（誰にも見られていない時だけ変える）' : ''}`;
  }
  if (task.kind === 'duty') {
    if (task.at === null) return '次の仕込みの持ち場へ向かうところ';
    const step = stepAt(actor.duties, task.at);
    if (task.workLeft === null) return `「${step.what}」をしに、${step.room} へ向かっている`;
    return realWork(actor) ? `${step.room} で「${step.what}」をしている` : `${step.room} で「${step.what}」のふりをしている`;
  }
  if (task.kind === 'fix') {
    const point = fixPointOf(world, task.point);
    if (task.workLeft === null) return `${point.room} の「${point.name}」へ、直しに向かっている`;
    return point.for === 'lights' ? `${point.room} の「${point.name}」で、あかりを直している` : `${point.room} の「${point.name}」についている（ほかの場所にも人がつくのを待っている）`;
  }
  if (task.kind === 'bell') return '中庭の鐘を鳴らしに向かっている';
  if (task.kind === 'sneak') {
    return task.until === null ? `${hatchOf(world, task.from).room} の抜け道の出入口へ向かっている` : `床下の抜け道を、${hatchOf(world, task.to).room} へ進んでいる`;
  }
  return '待っている';
}

/** 歩き回っている間の、エージェントへの唯一の情報の経路。座標や、見えていない相手のことは入れない。 */
export function buildRoamObservation(world: RoamWorld, id: PlayerId): RoamObservation {
  const me = playerById(world, id);
  if (me.status !== 'awake') throw new Error('起きていない人の観測は作れません');
  const actor = actorById(world, id);
  const allies =
    me.role === 'nibbler' ? world.players.filter((p) => p.role === 'nibbler' && p.id !== id).map((p) => p.name) : [];
  const { trouble } = world;
  const wait = (until: number) => Math.max(0, Math.ceil(until - world.clock));
  const hatchGroups = new Map<string, string[]>();
  for (const hatch of world.map.def.hatches ?? []) hatchGroups.set(hatch.group, [...(hatchGroups.get(hatch.group) ?? []), hatch.room]);
  return {
    kind: 'roam',
    self: { name: me.name, role: me.role, persona: me.persona, style: me.style, allies, bonds: me.bonds ?? [] },
    round: world.round,
    clock: Math.floor(world.clock),
    secondsUntilOpening: Math.max(0, Math.ceil(world.roam.roamSeconds - world.clock)),
    where: actor.under ? UNDER_FLOOR : areaAt(world.map, actor.pos),
    visible: visibleTo(world, id).map((other) => {
      const seen = actorById(world, other);
      const asleep = playerById(world, other).status === 'asleep';
      return { name: nameOf(world, other), where: areaAt(world.map, seen.pos), asleep, working: !asleep && isWorking(seen) };
    }),
    duties: actor.duties.map((duty) => ({ name: duty.name, steps: duty.steps.map((step) => ({ what: step.what, room: step.room, done: step.done })) })),
    taskBar: world.taskTotal > 0 ? { done: world.taskDone, total: world.taskTotal } : null,
    trouble: trouble
      ? {
          kind: trouble.kind,
          secondsLeft: trouble.kind === 'crisis' ? wait(trouble.deadline) : null,
          fixAt: troubleFixPoints(world, trouble.kind).map((point) => ({
            name: point.name,
            room: point.room,
            held: trouble.kind === 'crisis' && (trouble.held[point.id] ?? null) !== null,
          })),
        }
      : null,
    shutRooms: world.shut.filter((s) => noticesShut(world, actor, s.room)).map((s) => s.room),
    bell: world.map.def.bell ? { usesLeft: actor.bellUsesLeft, waitSeconds: wait(world.bellReadyAt) } : null,
    sabotage: actor.nibbler && ((world.map.def.fixPoints ?? []).length > 0 || Object.keys(world.map.doorTiles).length > 0)
      ? { waitSeconds: wait(world.sabotageReadyAt), doorWaitSeconds: wait(world.doorReadyAt), doorRooms: Object.keys(world.map.doorTiles) }
      : null,
    hatches: actor.nibbler ? [...hatchGroups].map(([group, rooms]) => ({ group, rooms })) : null,
    events: [...actor.events],
    heard: actor.heard.map((h) => ({ ...h })),
    chatWaitSeconds: wait(actor.chatReadyAt),
    activity: describeTask(world, actor),
    idle: actor.task === null,
    lastResult: actor.lastResult,
    napCooldown: me.role === 'nibbler' ? Math.max(0, Math.ceil((world.napReadyAt[id] ?? 0) - world.clock)) : null,
    rooms: [...world.map.roomNames],
    layout: Object.entries(world.map.links).map(([name, next]) => `${name}: ${next.join('、')}`),
    crossSeconds: Math.max(5, Math.round(world.map.span / world.roam.speed / 5) * 5),
    roster: world.roster.map((seat) => nameOf(world, seat)),
    cast: castOf(world),
    // 工房にいない人は、集会で全員に分かったことだけ
    away: world.roster.flatMap((other) => {
      const status = playerById(world, other).status;
      return actorById(world, other).onMap || status === 'awake' ? [] : [{ name: nameOf(world, other), status }];
    }),
    history: [...world.history],
  };
}

/** 意図を適用できなかったとき、その理由を本人の「直前の結果」に入れる。 */
export function noteRejection(world: RoamWorld, id: PlayerId, reason: string): void {
  actorById(world, id).lastResult = `できなかった: ${reason}`;
}
