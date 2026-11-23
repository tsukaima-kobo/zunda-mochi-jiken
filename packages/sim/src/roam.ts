// 工房の中を歩き回る時間と、試合全体の流れ（見回り → 集会 → 見回り → …）。
// エージェントは「どの部屋へ行く」「仕込みを進める」「知らせる」などの意図だけを決め、
// 道を探して歩くこと、持ち場で手を動かすこと、近づいて餅に変えることは、ここ（コード）がやる。
//
// この作品での出来事:
// - 従業員は、工房のあちこちの持ち場を回って、自分の仕込みを進める。全員の仕込みが終われば従業員の勝ち。
// - 従業員にまぎれた「ずんだの妖精」は、人をずんだ餅に変えてしまう。乱暴なことは起きない。
//   仕込みはふりだけ。床下の抜け道を通れる。あかりを消す、かまどを焚きすぎる、戸を閉める、の妨害ができる。
// - 「妖精マニア」は、妖精の味方をする人間（人狼の狂人）。誰が妖精かは知らず、妖精も知らない。
//   仕込みはふりだけで、特別な行動は無い。頭数は人間側に数える。妖精が勝てば勝ち。
// - ずんだ餅になった人を見つけた人は知らせて、集会を開ける。中庭の鐘を鳴らして、みんなを集めることもできる。
// - 「狐」は、ひとりだけの陣営。自分の仕込みを決まった数（foxSteps）だけ終えたうえで、試合が終わった時に起きていれば、勝ちを横取りする。
//   妖精に餅にされるし、占い師に占われても餅になる。狐の仕込みは、従業員の進み具合には入らない。
// - 「占い師」は、従業員側の人間。見回り1回につき1人、そばにいる相手を占って、妖精かどうかを知る（周りからは分からない）。
// - 工房の道具は誰でも使える: 見取り図の盤（部屋ごとの、いまの人数）・名札かけ（誰がずんだ餅になったか）・
//   防犯カメラの画面（廊下のカメラに映っている人。見ている間は、カメラの赤いランプがつく）。
// - 集会の投票で選ばれた人は、工房からクビにする。全員に分かるのは、その人が妖精だったかどうかだけ。
// - ずんだ餅になった従業員は、心だけになって自分の仕込みを続ける（起きている人には見えない）。
// - 起きている人間（従業員と妖精マニア）が、妖精の人数以下になれば、妖精の勝ち。
//   かまどの焚きすぎを時間内に直せなかった時と、開店の時刻までに仕込みが終わらなかった時も、妖精の勝ち。
// （内部の名前 nibbler・nap・asleep は、前の題材「つまみ食い犯・おひるね」のなごり。記録の互換のために残している）

import { bondsOf, CAST, NO_TARGET, ROAM_SAY_MAX_CHARS, SABOTAGE_CRISIS, SABOTAGE_LIGHTS } from '../../protocol/src/index.ts';
import type { CastMember, Divined, Role, RoamObservation, Side } from '../../protocol/src/index.ts';
import { areaAt, centerOf, findRoute, findRouteThroughDoors, hasLineOfSight, isWalkable, parseMap, tileOf } from './map.ts';
import type { CameraPoint, DeviceDefinition, DeviceKind, DutyDefinition, FixPoint, GameMap, Hatch, MapDefinition, Point, Station } from './map.ts';
import { createRng } from './rng.ts';
import { castOf, clockText, DEFAULT_MEETING_CONFIG, foxesOutOf, nameOf, playerById, RuleViolation } from './world.ts';
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
  /**
   * ずんだ餅になった人を知らせられる距離（タイル）。餅のすぐそばまで近づかないと、知らせられない。
   * （前は、見えていれば、どれだけ離れていても知らせられた。1.5 は、手をかざす距離・占う距離と同じにした、わたしの決めた値）
   */
  reportRange: number;
  /** 妖精の人数。0 なら人数から決める（9人以上で2人）。 */
  nibblers: number;
  /** 妖精マニアの人数。-1 なら人数から決める（いまは 0。狐に置きかえた）。 */
  madmen: number;
  /** 狐の人数。-1 なら人数から決める（11人以上で1人）。 */
  foxes: number;
  /**
   * 狐が勝ちを横取りするために、終えておく自分の仕込みの工程の数。0 なら条件なし（起きていれば横取り）。
   */
  foxSteps: number;
  /** 占い師の人数（0 なら、いない）。 */
  seers: number;
  /** 占える距離（タイル）。 */
  divineRange: number;
  /** 占うのに、相手のそば（divineRange 以内で、見えている）にいつづける秒数。途中で離れると、はじめから。0 なら近づいた瞬間に占える（2026-11-21 夜から 10）。 */
  divineSeconds: number;
  /** 本人に同時に見えている仕込みの数。1つ終えるたびに、まだ見えていない仕込みが1つ出る。0 なら全部見える（2026-11-21 夜から 3）。 */
  dutiesShown: number;
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
  /** 見取り図の盤・名札かけを見るのにかかる秒数。 */
  lookSeconds: number;
  /** 防犯カメラの画面を、1回で見続ける秒数。 */
  cameraSeconds: number;
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
  reportRange: 1.5,
  nibblers: 0,
  madmen: -1,
  foxes: -1,
  foxSteps: 7,
  seers: 0,
  divineRange: 1.5,
  divineSeconds: 10,
  dutiesShown: 3,
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
  lookSeconds: 2,
  cameraSeconds: 8,
};

/** 見回りの間に1回で話せる長さ（字）。長い分は切る。 */
export const CHAT_MAX_CHARS = ROAM_SAY_MAX_CHARS;

/** doors は、道を決めた時の「戸の開け閉めの番号」。変わっていたら、道を探し直す。 */
type Task =
  | { kind: 'move_to'; room: string; goal: Point; doors: number }
  | { kind: 'follow'; targetId: PlayerId; startedAt: number; lostSince: number | null }
  | { kind: 'nap'; targetId: PlayerId; startedAt: number; lostSince: number | null; onlyIfUnseen: boolean }
  /** 占い師が、相手に近づいて占う。 */
  /** nearSince: 相手のそばに続けている時刻（離れたら null。divineSeconds 続いたら占える）。 */
  | { kind: 'divine'; targetId: PlayerId; startedAt: number; lostSince: number | null; nearSince: number | null }
  | { kind: 'wait'; until: number }
  /** at は、いま向かっている（している）仕込みと手順の番号。workLeft は、手を動かす残り秒数（歩いている間は null）。 */
  | { kind: 'duty'; want: string | null; at: [number, number] | null; workLeft: number | null; doors: number }
  /** auto: 場所を指定せずに直しに来た（先に人がついた所を避けて、空いている所へ回る） */
  | { kind: 'fix'; point: string; workLeft: number | null; doors: number; auto: boolean }
  | { kind: 'bell'; doors: number }
  /** 見つけたずんだ餅のそばまで歩いて、着いたら知らせる（餅は動かない）。 */
  | { kind: 'report'; targetId: PlayerId; doors: number }
  /** until は、抜け道から出る時刻（出入口へ歩いている間は null）。 */
  | { kind: 'sneak'; from: string; to: string; until: number | null; doors: number }
  /**
   * 工房の道具を見る。until は見終わる時刻（道具へ歩いている間は null）。
   * seen は、防犯カメラに映った人（カメラの場所 → 人）。noticed は、カメラに映ったのを知らせた、ずんだ餅になった人。
   */
  | { kind: 'look'; device: DeviceKind; until: number | null; doors: number; seen: Record<string, PlayerId[]>; noticed: PlayerId[] };

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
  /** 本人に見えているか。最初に dutiesShown 個が見え、1つ終えるたびに、まだ見えていないものが1つ出る（2026-11-21 夜から）。 */
  shown: boolean;
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
  /** 妖精マニア。仕込みはふりだけで、特別な行動は無い。 */
  madman: boolean;
  /** 狐。仕込みはふりだけで、特別な行動は無い。 */
  fox: boolean;
  /** 占い師。従業員と同じに仕込みを進め、見回り1回につき1人を占える。 */
  seer: boolean;
  /** 最後に占った見回りの番号（まだ占っていなければ 0）。占えるのは見回り1回につき1人（2026-11-21 夕 から。その前は1試合に1回）。 */
  divinedRound: number;
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
  /** 自分の仕込み。妖精と妖精マニアのものは、ふりをするための見せかけ。 */
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
  /** 見ていた人。sawWho が false なら、餅に変わるところだけ見えた。camera は、防犯カメラの画面で見ていた時の、カメラの場所。 */
  witnesses: { id: PlayerId; sawWho: boolean; camera?: string }[];
}

/** 餅に変えられた以外の出来事の記録。観戦者とログのためのもので、エージェントには渡さない。 */
export type Happening =
  /**
   * 仕込みの手順が1つ終わった。pretend はふりだけ（進み具合は増えない）。spirit は心だけの姿。
   * fox は、狐の分だけ: 狐自身の仕込みの進み（done 工程 / 横取りに要る need 工程）。狐の仕込みも、従業員の進み具合は増やさない（pretend は true のまま）。
   */
  | { type: 'task'; t: number; id: PlayerId; duty: string; what: string; station: string; pretend: boolean; spirit: boolean; done: number; total: number; fox?: { done: number; need: number } }
  | { type: 'sabotage'; t: number; id: PlayerId; what: 'lights' | 'crisis' | 'door'; room: string | null; seconds: number | null }
  | { type: 'fixed'; t: number; what: 'lights' | 'crisis'; ids: PlayerId[] }
  | { type: 'door_open'; t: number; room: string }
  | { type: 'sneak'; t: number; id: PlayerId; phase: 'in' | 'out'; room: string; hatch: string; witnesses: PlayerId[] }
  | { type: 'bell'; t: number; id: PlayerId }
  /**
   * 工房の道具を見た。start は見始め、end は見終わり（aborted は、途中で集会になった・ほかの行動に移った）。
   * end には、見えたもの: admin は部屋ごとの人数、vitals は全員の名札、cameras はカメラごとに映った人。
   */
  | {
      type: 'look';
      t: number;
      id: PlayerId;
      device: DeviceKind;
      phase: 'start' | 'end';
      aborted?: boolean;
      counts?: Record<string, number>;
      tags?: { id: PlayerId; status: 'awake' | 'asleep' | 'sent_home' }[];
      seen?: { camera: string; ids: PlayerId[] }[];
    }
  /** 近くの人にだけ聞こえる声で話した。heard は聞こえた人（話した本人は入らない）。 */
  | { type: 'chat'; t: number; id: PlayerId; text: string; heard: PlayerId[] }
  /**
   * 占い師が占った。fairy: 妖精だった。cursed: 占われた狐が、その場でずんだ餅に変わった
   * （witnesses は、餅に変わるところを見た人。camera は、防犯カメラの画面で見ていた時の、カメラの場所）。
   */
  | { type: 'divine'; t: number; id: PlayerId; targetId: PlayerId; room: string; fairy: boolean; cursed: boolean; witnesses: { id: PlayerId; camera?: string }[] }
  /** 妖精が狐に手をかざしたが、狐はずんだ餅にならなかった（狐には妖精の手が効かない。2026-11-21 から）。witnesses は、手をかざすところまで見えた人。 */
  | { type: 'nap_failed'; t: number; id: PlayerId; targetId: PlayerId; room: string; witnesses: { id: PlayerId; camera?: string }[] };

export type Trouble = { kind: 'lights' } | { kind: 'crisis'; deadline: number; held: Record<string, PlayerId | null> };

export type GameResult = {
  /** 勝った側。狐が、自分の仕込みを決まった数だけ終えて、起きたまま試合が終わると、狐（stolenFrom は、本来なら勝っていた側）。 */
  winner: Side;
  stolenFrom?: Side;
  /** 狐が起きたまま試合が終わったが、自分の仕込みが足りず、横取りできなかった（done 工程 / 要るのは need 工程）。 */
  foxMissed?: { done: number; need: number };
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
  truth: { nibblerIds: PlayerId[]; madmanIds: PlayerId[]; foxIds: PlayerId[]; seerIds: PlayerId[] };
}

export interface RoamWorldOptions {
  seed: number;
  map: MapDefinition;
  players?: number;
  roam?: Partial<RoamConfig>;
  config?: Partial<MeetingConfig>;
}

/** この人数から、妖精マニアを1人入れる（人数で決める時）。2026-11-18 から狐に置きかえたので、人数では入れない。 */
export const MADMAN_FROM = Infinity;
/** この人数から、狐を1人入れる（人数で決める時）。 */
export const FOX_FROM = 11;

/**
 * クビになった人について、全員に公表する文。妖精だったかどうか。狐は、狐だったと分かる
 */
function ejectedVerdict(role: Role): string {
  return role === 'nibbler' ? '妖精だった' : role === 'fox' ? '狐だった' : '妖精ではなかった';
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
  // 妖精マニアは、ほかの割り当てを変えないよう、別の乱数で選ぶ
  const madmanCount = Math.max(0, Math.min(roam.madmen >= 0 ? roam.madmen : count >= MADMAN_FROM ? 1 : 0, count - nibblerCount - 2));
  const madmanIds = createRng(options.seed * 131 + 17).shuffle(ids.filter((id) => !nibblerIds.includes(id))).slice(0, madmanCount);
  // 狐も、別の乱数で選ぶ（妖精マニアを選んだ時と、同じ人が選ばれやすいように、同じ乱数を使う）
  const foxCount = Math.max(0, Math.min(roam.foxes >= 0 ? roam.foxes : count >= FOX_FROM ? 1 : 0, count - nibblerCount - madmanCount - 2));
  const foxIds = createRng(options.seed * 131 + 17).shuffle(ids.filter((id) => !nibblerIds.includes(id) && !madmanIds.includes(id))).slice(0, foxCount);
  // 占い師も、ほかの割り当てを変えないよう、別の乱数で選ぶ（従業員の中から）
  const plain = ids.filter((id) => !nibblerIds.includes(id) && !madmanIds.includes(id) && !foxIds.includes(id));
  const seerCount = Math.max(0, Math.min(roam.seers, plain.length - 2));
  const seerIds = createRng(options.seed * 173 + 29).shuffle(plain).slice(0, seerCount);
  const players: PlayerTruth[] = ids.map((id, i) => {
    const role: Role = nibblerIds.includes(id) ? 'nibbler' : madmanIds.includes(id) ? 'madman' : foxIds.includes(id) ? 'fox' : seerIds.includes(id) ? 'seer' : 'artisan';
    return {
      id,
      name: names[i] as string,
      role,
      persona: (cast[i] as CastMember).persona,
      style: (cast[i] as CastMember).style,
      bonds: bondsOf(names[i] as string, names),
      status: 'awake',
      facts: [],
      ...(role === 'seer' ? { divined: [] } : {}),
    };
  });
  // 名簿の並び（全員が知っている）。役職や作った順では並べない
  const roster = rng.shuffle(ids);
  const spawns = rng.shuffle(map.def.spawn);

  // 仕込みの割り当て。妖精と妖精マニアにも同じ形のものを配る（ふりをするため）
  const dutyRng = createRng(options.seed * 31 + 7);
  const defs = map.def.duties ?? [];
  const stations = new Map((map.def.stations ?? []).map((station) => [station.id, station]));
  const groups = map.def.dutyGroups ?? [];
  const byGroup = roam.dutySteps > 0 && groups.length > 0;
  /** 1人に配る工程の数（pick があれば、その数）。 */
  const sizeOf = (d: DutyDefinition) => Math.min(d.pick ?? d.steps.length, d.steps.length);
  // もう配った人の数を数えておき、少ないものから選ぶ。同じ数の中では、種で決めた乱数の順
  const dutyUse = new Map<string, number>();
  const stationUse = new Map<string, number>();
  const stationIds = (step: DutyDefinition['steps'][number]): string[] => (Array.isArray(step.station) ? step.station : [step.station]);
  /** その仕込みを、もう何人に配ったか（持ち場の重なりも足す）。 */
  const loadOf = (d: DutyDefinition) => (dutyUse.get(d.name) ?? 0) * 10 + Math.min(...d.steps.map((step) => Math.min(...stationIds(step).map((id) => stationUse.get(id) ?? 0))));
  const leastUsed = <T>(items: readonly T[], load: (item: T) => number): T[] =>
    dutyRng
      .shuffle([...items])
      .map((item, order) => ({ item, order, n: load(item) }))
      .sort((a, b) => a.n - b.n || a.order - b.order)
      .map((x) => x.item);
  /** 種類ごとに、工程の数の枠を決め、その種類の長い仕込みを1つ（枠に収まるもの）と、短い仕込みで枠を埋める。 */
  const groupDuties = (): DutyDefinition[] => {
    const chosen = defs.filter((d) => d.kind === 'common');
    const total = groups.reduce((sum, g) => sum + g.share, 0);
    for (const group of groups) {
      let left = Math.round((roam.dutySteps * group.share) / total) - chosen.filter((d) => d.group === group.id).reduce((sum, d) => sum + sizeOf(d), 0);
      const longs = leastUsed(defs.filter((d) => d.group === group.id && d.kind === 'long' && sizeOf(d) <= left), loadOf);
      const shorts = leastUsed(defs.filter((d) => d.group === group.id && d.kind === 'short'), loadOf);
      // 長い仕込みは、短い仕込みより多くの人に配っていない時に配る（短い仕込みだけで枠が埋まらない時は、いつも配る）。
      // 枠が小さい時に、入る長い仕込みが1つしかなく、全員に同じものが配られるのを防ぐ（2026-11-21 夜）
      const long = longs[0];
      const first = shorts[0];
      if (left >= 2 && long && (shorts.length < left || !first || loadOf(long) <= loadOf(first))) {
        chosen.push(long);
        left -= sizeOf(long);
      }
      for (const pick of shorts) {
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
          ...leastUsed(defs.filter((d) => d.kind === 'long'), loadOf).slice(0, roam.longDuties),
          ...leastUsed(defs.filter((d) => d.kind === 'short'), loadOf).slice(0, roam.shortDuties),
        ];
    // 見える順は、出す時に決める（ほかの人と重ならないもの）。同じ重なりなら、この並び（種で決めた乱数）
    const duties = dutyRng.shuffle(chosen).map((def) => ({
      name: def.name,
      shown: roam.dutiesShown <= 0,
      // 本家の配線の修理のように、何か所かのうちから、人ごとに選ぶ（並びは定義のまま）。場所の候補がいくつかある工程も、人ごとに1か所を選ぶ（2026-11-21 から）。
      // どちらも、もう配った人の少ない持ち場から選ぶ（2026-11-21 夜から）
      steps: (sizeOf(def) < def.steps.length
        ? leastUsed(def.steps.map((_, i) => i), (i) => Math.min(...stationIds(def.steps[i] as DutyDefinition['steps'][number]).map((id) => stationUse.get(id) ?? 0)))
            .slice(0, sizeOf(def))
            .sort((a, b) => a - b)
            .map((i) => def.steps[i] as DutyDefinition['steps'][number])
        : def.steps
      ).map((step) => {
        const id = leastUsed(stationIds(step), (sid) => stationUse.get(sid) ?? 0)[0] as string;
        const station = stations.get(id);
        if (!station) throw new Error(`マップに無い持ち場です: ${id}`);
        stationUse.set(id, (stationUse.get(id) ?? 0) + 1);
        return { station: station.id, what: station.name, room: station.room, seconds: Math.max(1, Math.round(step.seconds * roam.dutyPace)), done: false };
      }),
    }));
    for (const def of chosen) dutyUse.set(def.name, (dutyUse.get(def.name) ?? 0) + 1);
    return duties;
  };
  const actors: Actor[] = roster.map((id, i) => {
    const [x, y] = spawns[i] as [number, number];
    return {
      id,
      nibbler: nibblerIds.includes(id),
      madman: madmanIds.includes(id),
      fox: foxIds.includes(id),
      seer: seerIds.includes(id),
      divinedRound: 0,
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
  // 最初に見える仕込み: 名簿の順に1つずつ、dutiesShown 回まわして出す（先に出した人の仕込みと、なるべく重ならないように）
  if (roam.dutiesShown > 0) for (let k = 0; k < roam.dutiesShown; k++) for (const actor of actors) revealDuty(actors, actor);

  // 狐の横取りの条件（自分の仕込みの工程の数）。本人の観測にだけ、進みが入る（2026-11-21 から）
  if (roam.foxSteps > 0) {
    for (const actor of actors) {
      if (!actor.fox) continue;
      const steps = actor.duties.flatMap((duty) => duty.steps).length;
      const player = players.find((p) => p.id === actor.id);
      if (player) player.foxWork = { done: 0, need: Math.min(roam.foxSteps, steps) };
    }
  }

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
    truth: { nibblerIds, madmanIds, foxIds, seerIds },
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

// ───────── 工房の道具 ─────────

function deviceOf(world: RoamWorld, kind: DeviceKind): DeviceDefinition | null {
  return world.map.def.devices?.[kind] ?? null;
}

/** 道具の名前から種類を引く（この工房に無い道具なら null）。 */
function deviceKindByName(world: RoamWorld, name: string): DeviceKind | null {
  const devices = world.map.def.devices ?? {};
  for (const kind of ['admin', 'vitals', 'cameras'] as const) if (devices[kind]?.name === name) return kind;
  return null;
}

function cameraPoints(world: RoamWorld): CameraPoint[] {
  return world.map.def.devices?.cameras?.points ?? [];
}

/** カメラに映るか。距離の内で、あいだに壁や閉まった戸が無いこと。暗くても映る。床下の抜け道の中は映らない。 */
function cameraSees(world: RoamWorld, camera: CameraPoint, point: Point): boolean {
  const radius = world.map.def.devices?.cameras?.radius ?? 0;
  const eye = centerOf(camera);
  return Math.hypot(point.x - eye.x, point.y - eye.y) <= radius && hasLineOfSight(world.map, eye, point);
}

/** いま防犯カメラの画面を見ている人（名簿順）。 */
function cameraWatchers(world: RoamWorld): PlayerId[] {
  return awakeIds(world).filter((id) => {
    const task = actorById(world, id).task;
    return task?.kind === 'look' && task.device === 'cameras' && task.until !== null;
  });
}

/** その人が、いま防犯カメラの画面で見ている所のうち、point が映っているカメラ（見ていなければ空）。 */
function camerasShowing(world: RoamWorld, watcher: Actor, point: Point): CameraPoint[] {
  const task = watcher.task;
  if (task?.kind !== 'look' || task.device !== 'cameras' || task.until === null) return [];
  return cameraPoints(world).filter((camera) => cameraSees(world, camera, point));
}

/** カメラごとに、いま映っている人（ずんだ餅になった人も入る）。並びは名簿順。 */
function cameraView(world: RoamWorld, camera: CameraPoint): PlayerId[] {
  return world.roster.filter((id) => {
    const other = actorById(world, id);
    return other.onMap && !other.under && cameraSees(world, camera, other.pos);
  });
}

/** 道具を見ている人なら、その道具の名前（歩いて向かっている間は null）。そばで見ている人には分かる。 */
function lookingAt(world: RoamWorld, actor: Actor): string | null {
  const task = actor.task;
  return task?.kind === 'look' && task.until !== null ? (deviceOf(world, task.device)?.name ?? null) : null;
}

/** 見取り図の盤: 部屋ごとの、いまの人数（ずんだ餅になった人も数える。廊下と、床下の抜け道の中は出ない）。 */
function adminCounts(world: RoamWorld): Record<string, number> {
  const counts: Record<string, number> = Object.fromEntries(Object.values(world.map.def.rooms).map((room) => [room, 0]));
  for (const other of world.actors) {
    if (!other.onMap || other.under) continue;
    const room = areaAt(world.map, other.pos);
    if (room in counts) counts[room] = (counts[room] ?? 0) + 1;
  }
  return counts;
}

/** 名札かけ: 全員の名札（起きている・ずんだ餅になった・クビ）。名簿順。 */
function vitalsTags(world: RoamWorld): { id: PlayerId; status: 'awake' | 'asleep' | 'sent_home' }[] {
  return world.roster.map((id) => {
    const status = playerById(world, id).status;
    return { id, status: status === 'asleep' ? 'asleep' : status === 'sent_home' ? 'sent_home' : 'awake' };
  });
}

function joinNames(world: RoamWorld, ids: readonly PlayerId[]): string {
  return ids.map((id) => nameOf(world, id)).join('、');
}

/** 見終わった時に、本人に伝える文（見えたものだけ）。 */
function lookReading(world: RoamWorld, device: DeviceDefinition, kind: DeviceKind, task: Extract<Task, { kind: 'look' }>): string {
  if (kind === 'admin') {
    const counts = Object.entries(adminCounts(world)).filter(([, n]) => n > 0);
    return `${device.room}の「${device.name}」を見た: ${counts.map(([room, n]) => `${room} ${n}人`).join('、')}（ほかの部屋は0人。廊下にいる人は盤に出ない。誰なのかは出ない）`;
  }
  if (kind === 'vitals') {
    const tags = vitalsTags(world);
    const asleep = tags.filter((t) => t.status === 'asleep').map((t) => t.id);
    const gone = tags.filter((t) => t.status === 'sent_home').map((t) => t.id);
    const parts = [`ずんだ餅になっている: ${asleep.length > 0 ? joinNames(world, asleep) : 'いない'}`];
    if (gone.length > 0) parts.push(`クビ: ${joinNames(world, gone)}`);
    return `${device.room}の「${device.name}」を見た: ${parts.join('。')}。ほかの人は起きている`;
  }
  const views = cameraPoints(world).map((camera) => {
    const ids = task.seen[camera.name] ?? [];
    return `${camera.name}のカメラ: ${ids.length > 0 ? joinNames(world, ids) : '誰も映らなかった'}`;
  });
  return `${device.room}の「${device.name}」を${world.roam.cameraSeconds}秒ほど見た: ${views.join(' / ')}`;
}

/**
 * 道具を見終わる（aborted なら途中でやめた）。見終わった時は、見えたものを本人に伝え、記録に残す。
 * 歩いて向かっている途中なら、記録には何も残さない。
 */
function endLook(world: RoamWorld, actor: Actor, aborted: boolean, task: Task | null = actor.task): void {
  if (task?.kind !== 'look' || task.until === null) return;
  const device = deviceOf(world, task.device) as DeviceDefinition;
  const seen = cameraPoints(world).map((camera) => ({ camera: camera.name, ids: task.seen[camera.name] ?? [] }));
  world.happenings.push({
    type: 'look',
    t: world.clock,
    id: actor.id,
    device: task.device,
    phase: 'end',
    ...(aborted ? { aborted: true } : {}),
    ...(task.device === 'admin' && !aborted ? { counts: adminCounts(world) } : {}),
    ...(task.device === 'vitals' && !aborted ? { tags: vitalsTags(world) } : {}),
    ...(task.device === 'cameras' ? { seen } : {}),
  });
  if (aborted) {
    task.until = null;
    return;
  }
  const reading = lookReading(world, device, task.device, task);
  task.until = null;
  stop(actor, reading);
}

/** 防犯カメラの画面を見ている人に、いま映っているものを伝える（ずんだ餅になった人が新しく映ったら、知らせる）。 */
function watchCameras(world: RoamWorld): void {
  for (const id of cameraWatchers(world)) {
    const actor = actorById(world, id);
    const task = actor.task as Extract<Task, { kind: 'look' }>;
    for (const camera of cameraPoints(world)) {
      const view = cameraView(world, camera).filter((other) => other !== id);
      const seen = new Set([...(task.seen[camera.name] ?? []), ...view]);
      task.seen[camera.name] = world.roster.filter((other) => seen.has(other));
      for (const other of view) {
        if (playerById(world, other).status !== 'asleep' || task.noticed.includes(other)) continue;
        task.noticed.push(other);
        actor.events.push(`防犯カメラ（${camera.name}）に、ずんだ餅になった ${nameOf(world, other)} が映っている`);
      }
    }
  }
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
/**
 * まだ見えていない仕込みを1つ出す。ほかの人にいま見えていて、まだ終わっていない仕込みと、名前も持ち場もなるべく重ならないものを選ぶ
 * 同じ重なりなら、配った時の並び（種で決めた乱数）の早いもの。
 */
function revealDuty(actors: readonly Actor[], actor: Actor): void {
  const hidden = actor.duties.filter((duty) => !duty.shown);
  if (hidden.length === 0) return;
  const names = new Map<string, number>();
  const stations = new Map<string, number>();
  for (const other of actors) {
    if (other === actor) continue;
    for (const duty of other.duties) {
      if (!duty.shown || duty.steps.every((step) => step.done)) continue;
      names.set(duty.name, (names.get(duty.name) ?? 0) + 1);
      for (const step of duty.steps) if (!step.done) stations.set(step.station, (stations.get(step.station) ?? 0) + 1);
    }
  }
  const load = (duty: Duty) => (names.get(duty.name) ?? 0) * 10 + duty.steps.reduce((n, step) => n + (stations.get(step.station) ?? 0), 0);
  let best = hidden[0] as Duty;
  for (const duty of hidden) if (load(duty) < load(best)) best = duty;
  best.shown = true;
}

function chooseStep(world: RoamWorld, duties: Duty[], pos: Point, want: string | null): [number, number] | null {
  let best: [number, number] | null = null;
  let bestDistance = Infinity;
  duties.forEach((duty, d) => {
    if (!duty.shown) return;
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

/** 従業員だけが、本当に仕込みを進める（妖精・妖精マニア・狐は、ふりだけ）。 */
export function realWork(actor: Actor): boolean {
  return !actor.nibbler && !actor.madman && !actor.fox;
}

/**
 * 狐の、自分の仕込みの進み。done: 終えた工程 / need: 横取りに要る工程（決まりの数。自分に配られた工程より多くはしない。0 なら条件なし）。
 * 狐の仕込みは、従業員の進み具合には入らない。
 */
export function foxWork(world: RoamWorld, actor: Actor): { done: number; need: number } {
  const steps = actor.duties.flatMap((duty) => duty.steps);
  return { done: steps.filter((step) => step.done).length, need: Math.min(Math.max(0, world.roam.foxSteps), steps.length) };
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
  // 仕込みを1つ終えたら、次の仕込みが1つ出る
  if (duty.steps.every((x) => x.done)) revealDuty(world.actors, actor);
  if (realWork(actor)) world.taskDone += 1;
  if (actor.fox && world.roam.foxSteps > 0) playerById(world, actor.id).foxWork = foxWork(world, actor);
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
    ...(actor.fox && world.roam.foxSteps > 0 ? { fox: foxWork(world, actor) } : {}),
  });
}

/** 起きている人間（従業員・妖精マニア・狐）が、起きている妖精の人数以下になったら、妖精の勝ち。 */
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
  // 狐が、自分の仕込みを決まった数だけ終えて、起きたまま試合が終われば、どちらが勝っても、狐が勝ちを横取りする。
  // 起きていても仕込みが足りなければ、横取りできない（結果に foxMissed を残す。観戦者と記録のため）
  const foxes = world.players.filter((p) => p.role === 'fox' && p.status === 'awake').map((p) => foxWork(world, actorById(world, p.id)));
  const ready = foxes.some((work) => work.done >= work.need);
  const short = foxes.find((work) => work.done < work.need);
  world.result = ready && result.winner !== 'fox' ? { ...result, winner: 'fox', stolenFrom: result.winner } : !ready && short && result.winner !== 'fox' ? { ...result, foxMissed: short } : result;
  for (const actor of world.actors) endLook(world, actor, true);
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
  // 防犯カメラの画面で見ていた人（目の前で見た人は、もう上で数えた）
  for (const id of cameraWatchers(world)) {
    if (id === actor.id || id === target.id || witnesses.some((w) => w.id === id)) continue;
    const watcher = actorById(world, id);
    const camera = camerasShowing(world, watcher, target.pos)[0];
    if (!camera) continue;
    const sawWho = camerasShowing(world, watcher, actor.pos).length > 0;
    witnesses.push({ id, sawWho, camera: camera.name });
    watcher.events.push(
      sawWho
        ? `防犯カメラ（${camera.name}）に、${byName} が ${targetName} に手をかざし、${targetName} がずんだ餅に変わるのが映った`
        : `防犯カメラ（${camera.name}）に、${targetName} が急にずんだ餅に変わるのが映った（誰がそばにいたかは映っていなかった）`,
    );
  }
  endLook(world, target, true);
  playerById(world, target.id).status = 'asleep';
  target.task = null;
  target.path = [];
  // ずんだ餅になった従業員は、心だけになって自分の仕込みを続ける
  if (realWork(target)) target.spirit = { pos: { ...target.pos }, path: [], at: null, workLeft: null };
  stop(actor, `${targetName} をずんだ餅に変えた`);
  world.napReadyAt[actor.id] = world.clock + world.roam.napCooldown;
  world.incidents.push({ t: world.clock, round: world.round, byId: actor.id, targetId: target.id, room, witnesses });
}

/**
 * 妖精が狐に手をかざしたが、狐はずんだ餅にならない（狐には妖精の手が効かない）。妖精の力は使ったことになる（次に使えるまで待つ）。
 * 手をかざした妖精は、相手が狐だと分かる。狐は、手をかざされたことに気づかない（何も伝えない。普通の人狼の狐と同じ）。
 * 手をかざすところまで見えた人には、妖精と狐の両方が伝わる（これは残している）。
 */
function failNap(world: RoamWorld, actor: Actor, target: Actor): void {
  const byName = nameOf(world, actor.id);
  const targetName = nameOf(world, target.id);
  const room = areaAt(world.map, target.pos);
  // そばで見ていた人にも、防犯カメラで見ていた人にも、何も伝えない（狐にも伝えない）。分かるのは、手をかざした妖精だけ。
  // （前は、わたしが決めた作りで、見ていた人に「妖精と狐の両方が分かる」と伝えていた。前の記録の witnesses は、その時のもの）
  const witnesses: { id: PlayerId; camera?: string }[] = [];
  stop(actor, `${targetName} に手をかざしたが、ずんだ餅にならなかった。${targetName} は狐だ（狐には、妖精の手は効かない。${targetName} は、手をかざされたことに気づいていない）`);
  world.napReadyAt[actor.id] = world.clock + world.roam.napCooldown;
  world.happenings.push({ type: 'nap_failed', t: world.clock, id: actor.id, targetId: target.id, room, witnesses });
}

/**
 * 占い師が占う。分かるのは、相手が妖精かどうかだけ（本人にだけ伝える）。占ったことは、周りからは分からない。
 * 占われた狐は、その場でずんだ餅に変わる。見ていた人には、誰も手をかざしていないのに餅に変わった、とだけ伝える。
 */
function divine(world: RoamWorld, actor: Actor, target: Actor): void {
  const targetName = nameOf(world, target.id);
  const room = areaAt(world.map, target.pos);
  const fairy = target.nibbler;
  const cursed = target.fox;
  const witnesses: { id: PlayerId; camera?: string }[] = [];
  if (cursed) {
    for (const id of awakeIds(world)) {
      if (id === actor.id || id === target.id) continue;
      const watcher = actorById(world, id);
      if (!canSee(world, watcher, target)) continue;
      witnesses.push({ id });
      watcher.events.push(`${room} で ${targetName} が急にずんだ餅に変わるのを見た（見えた範囲では、誰も手をかざしていなかった）`);
    }
    for (const id of cameraWatchers(world)) {
      if (id === actor.id || id === target.id || witnesses.some((w) => w.id === id)) continue;
      const camera = camerasShowing(world, actorById(world, id), target.pos)[0];
      if (!camera) continue;
      witnesses.push({ id, camera: camera.name });
      actorById(world, id).events.push(`防犯カメラ（${camera.name}）に、${targetName} が急にずんだ餅に変わるのが映った（映った範囲では、誰も手をかざしていなかった）`);
    }
    endLook(world, target, true);
    playerById(world, target.id).status = 'asleep';
    target.task = null;
    target.path = [];
  }
  actor.divinedRound = world.round;
  const seer = playerById(world, actor.id);
  seer.divined = [...(seer.divined ?? []), { name: targetName, round: world.round, fairy, ...(cursed ? { cursed: true } : {}) }];
  world.happenings.push({ type: 'divine', t: world.clock, id: actor.id, targetId: target.id, room, fairy, cursed, witnesses });
  stop(actor, `${targetName} を占った: ${fairy ? '妖精だった' : '妖精ではなかった'}${cursed ? `。${targetName} は、その場でずんだ餅に変わった（狐だった）` : ''}`);
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
  for (const id of cameraWatchers(world)) {
    if (id === actor.id || witnesses.includes(id)) continue;
    const camera = camerasShowing(world, actorById(world, id), centerOf(hatch))[0];
    if (!camera) continue;
    witnesses.push(id);
    actorById(world, id).events.push(
      phase === 'in' ? `防犯カメラ（${camera.name}）に、${name} が床下の抜け道に入っていくのが映った` : `防犯カメラ（${camera.name}）に、${name} が床下の抜け道から出てくるのが映った`,
    );
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
    if (task?.kind === 'follow' || task?.kind === 'nap' || task?.kind === 'divine') {
      const target = actorById(world, task.targetId);
      const targetName = nameOf(world, task.targetId);
      if (canSee(world, actor, target)) {
        task.lostSince = null;
        if (!isAwake(world, task.targetId)) {
          // 見えている相手が餅になっているなら、ついていく意味がない（見えていない相手の様子は、ここでは使わない）
          stop(actor, `${targetName} はずんだ餅になっている`);
          continue;
        }
        const reach = task.kind === 'nap' ? roam.napRange * 0.8 : task.kind === 'divine' ? roam.divineRange * 0.8 : 1.5;
        const near = Math.hypot(target.pos.x - actor.pos.x, target.pos.y - actor.pos.y) <= reach;
        actor.path = near ? [] : (findRoute(map, actor.pos, target.pos) ?? []);
      } else {
        task.lostSince ??= clock;
      }
      if (task.lostSince !== null && clock - task.lostSince >= roam.followLostSeconds) {
        stop(actor, `${targetName} を見失った`);
      } else if (clock - task.startedAt >= roam.maxFollowSeconds + (task.kind === 'divine' ? roam.divineSeconds : 0)) {
        stop(actor, task.kind === 'nap' ? `${targetName} をずんだ餅に変える機会がなかった` : task.kind === 'divine' ? `${targetName} を占う機会がなかった` : `${targetName} についていくのをやめた`);
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
    } else if (task?.kind === 'report') {
      // 餅は動かないので、道を探すのは、はじめと、戸の開け閉めが変わった時だけ
      const mochi = actorById(world, task.targetId);
      if (!mochi.onMap || isAwake(world, task.targetId)) {
        stop(actor, `ずんだ餅になった ${nameOf(world, task.targetId)} は、もうそこにいない`);
      } else if (task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        const route = findRoute(map, actor.pos, mochi.pos);
        if (route) actor.path = route;
        else stop(actor, `戸が閉まっていて、ずんだ餅になった ${nameOf(world, task.targetId)} のそばへ行けない`);
      }
    } else if (task?.kind === 'sneak') {
      if (task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        const entry = hatchOf(world, task.from);
        if (!routeTo(world, actor, entry)) stop(actor, `戸が閉まっていて、${entry.room} の抜け道へ行けない`);
      }
    } else if (task?.kind === 'look' && task.until === null) {
      if (task.doors !== world.doorsVersion) {
        task.doors = world.doorsVersion;
        const device = deviceOf(world, task.device) as DeviceDefinition;
        if (!routeTo(world, actor, device)) stop(actor, `戸が閉まっていて、${device.room} の「${device.name}」へ行けない`);
      }
    }

    walk(actor, roam.speed * roam.tickSeconds);

    // ── 歩いたあと: 着いたか、手を動かし終えたか ──
    const now = actor.task;
    // 知らせに向かっている人は、餅のすぐそば（reportRange）まで来た所で知らせる（道の終わりまで歩かなくてよい）
    if (now?.kind === 'report') {
      const mochi = actorById(world, now.targetId);
      if (canSee(world, actor, mochi) && Math.hypot(mochi.pos.x - actor.pos.x, mochi.pos.y - actor.pos.y) <= roam.reportRange) {
        actor.lastResult = null;
        startMeeting(world, actor.id, now.targetId);
        return;
      }
      if (actor.path.length === 0) stop(actor, `ずんだ餅になった ${nameOf(world, now.targetId)} のそばまで行けなかった`);
      continue;
    }
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
    } else if (now.kind === 'look') {
      if (now.until === null) {
        if (!isAt(actor.pos, deviceOf(world, now.device) as DeviceDefinition)) continue;
        now.until = clock + (now.device === 'cameras' ? roam.cameraSeconds : roam.lookSeconds);
        world.happenings.push({ type: 'look', t: clock, id: actor.id, device: now.device, phase: 'start' });
      } else if (clock >= now.until - 1e-9) {
        endLook(world, actor, false);
      }
    }
  }

  // 防犯カメラの画面を見ている人に、映っているものを伝える
  watchCameras(world);

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

  // 全員が動いたあとで、占えるか・ずんだ餅に変えられるかを確かめる
  for (const id of tickOrder(world, active)) {
    const actor = actorById(world, id);
    const task = actor.task;
    if (task?.kind === 'divine') {
      if (!isAwake(world, id) || !isAwake(world, task.targetId)) continue;
      const seen = actorById(world, task.targetId);
      if (!canSee(world, actor, seen) || Math.hypot(seen.pos.x - actor.pos.x, seen.pos.y - actor.pos.y) > roam.divineRange) {
        // 離れたら、はじめから
        task.nearSince = null;
        continue;
      }
      task.nearSince ??= clock;
      if (clock - task.nearSince < roam.divineSeconds - 1e-9) continue;
      divine(world, actor, seen);
      // 占われた狐が餅になって、人数が足りなくなることがある
      const over = decideWinner(world);
      if (over) return finish(world, over);
      continue;
    }
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
      // 防犯カメラの画面で見ている人も、見ている人に数える
      const onCamera = cameraWatchers(world).some((other) => {
        const watcher = actorById(world, other);
        return other !== task.targetId && !watcher.nibbler && camerasShowing(world, watcher, actor.pos).length > 0;
      });
      if (watched || onCamera) continue;
    }
    if (target.fox) {
      failNap(world, actor, target);
      continue;
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
  for (const actor of world.actors) endLook(world, actor, true);
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
  // クビになった人については、妖精だったかどうかだけを公表する（妖精マニアかどうかは伝えない）
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
/** 意図を決めた時に本人が見ていたもの。sawAsleep: その時に見えていた、ずんだ餅になった人の名前。 */
export interface IntentContext {
  sawAsleep?: readonly string[];
}

export function applyRoamIntent(world: RoamWorld, id: PlayerId, intent: { action: string; target: string }, context: IntentContext = {}): void {
  const actor = world.actors.find((a) => a.id === id);
  const before = actor?.task ?? null;
  try {
    applyIntent(world, id, intent, context);
  } finally {
    // 道具を見ている途中で、ほかの行動に移った（見えたものは、それまでに伝わった分だけ）
    if (actor && before?.kind === 'look' && before.until !== null && actor.task !== before) endLook(world, actor, true, before);
  }
}

function applyIntent(world: RoamWorld, id: PlayerId, intent: { action: string; target: string }, context: IntentContext): void {
  if (world.stage !== 'roam') throw new RuleViolation('not_roaming', 'いまは歩き回る時間ではありません');
  if (!isAwake(world, id)) throw new RuleViolation('not_active', 'いまは動けません');
  const actor = actorById(world, id);
  const { action, target } = intent;
  const seen = (name: string) => visibleTo(world, id).find((other) => nameOf(world, other) === name);
  const nibblerOnly = action === 'transform' || action === 'transform_if_unseen' || action === 'sneak' || action === 'sabotage';
  // 妖精でない人には、知らない行動と同じ断り方をする（占い師でない人の「占う」も同じ）
  if (nibblerOnly && !actor.nibbler) throw new RuleViolation('unknown_action', 'その行動はできません');
  if (action === 'divine' && !actor.seer) throw new RuleViolation('unknown_action', 'その行動はできません');
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
  } else if (action === 'divine') {
    if (actor.divinedRound === world.round) throw new RuleViolation('divined', 'この見回りでは、もう占いました（占えるのは、見回り1回につき1人です）');
    const targetId = seen(target);
    if (!targetId) throw new RuleViolation('not_visible', 'その相手は、いま見えていません');
    if (!isAwake(world, targetId)) throw new RuleViolation('asleep', 'その相手は、もうずんだ餅になっています');
    if ((playerById(world, id).divined ?? []).some((d) => d.name === target)) throw new RuleViolation('divined_before', 'その相手は、もう占っています');
    // 同じ相手を占っている途中で頼み直しても、そばにいた時間は数え直さない
    // （判断のたびに同じ占いを選び直すと、10秒のはずが何倍もかかることがあった）
    const going = actor.task?.kind === 'divine' && actor.task.targetId === targetId ? actor.task : null;
    actor.task = { kind: 'divine', targetId, startedAt: world.clock, lostSince: going?.lostSince ?? null, nearSince: going?.nearSince ?? null };
  } else if (action === 'report') {
    // 考え始めた時に見えていた餅なら、考えている間に通りすぎても知らせられる（まだ工房の中にある時だけ）。
    const remembered = context.sawAsleep?.includes(target)
      ? world.roster.find((other) => other !== id && nameOf(world, other) === target && playerById(world, other).status === 'asleep' && actorById(world, other).onMap)
      : undefined;
    const targetId = seen(target) ?? remembered;
    if (!targetId || isAwake(world, targetId)) throw new RuleViolation('nothing_to_report', 'ずんだ餅になったその人が、いま見えていません');
    // 餅のすぐそば（reportRange）にいれば、その場で知らせる。離れていれば、餅のそばまで歩いていき、着いた所で知らせる。
    const mochi = actorById(world, targetId);
    if (canSee(world, actor, mochi) && Math.hypot(mochi.pos.x - actor.pos.x, mochi.pos.y - actor.pos.y) <= world.roam.reportRange) {
      actor.lastResult = null;
      startMeeting(world, id, targetId);
      return;
    }
    // 同じ餅へ向かっている途中で頼み直しても、歩きはそのまま続ける
    if (!(actor.task?.kind === 'report' && actor.task.targetId === targetId)) {
      actor.task = { kind: 'report', targetId, doors: -1 };
      actor.path = [];
    }
  } else if (action === 'wait') {
    actor.task = { kind: 'wait', until: world.clock + world.roam.waitSeconds };
    actor.path = [];
  } else if (action === 'do_task') {
    const open = actor.duties.filter((duty) => duty.shown && duty.steps.some((step) => !step.done));
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
  } else if (action === 'check') {
    const kind = deviceKindByName(world, target);
    if (!kind) throw new RuleViolation('unknown_device', 'その名前の道具は、この工房にありません');
    const current = actor.task;
    if (current?.kind === 'look' && current.device === kind) {
      // もう見ている（向かっている）なら、そのまま続ける。防犯カメラは、見る時間をのばす
      if (kind === 'cameras' && current.until !== null) current.until = Math.max(current.until, world.clock + world.roam.cameraSeconds);
    } else {
      const device = deviceOf(world, kind) as DeviceDefinition;
      if (!findRoute(world.map, actor.pos, centerOf(device))) throw new RuleViolation('no_path', 'いまは、そこへ行く道がありません');
      actor.task = { kind: 'look', device: kind, until: null, doors: -1, seen: {}, noticed: [] };
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
    if (!exit) throw new RuleViolation('no_hatch', 'その部屋に、抜け道はありません');
    // 同じ組の出入口のうち、いちばん近い所から入る
    const entries = hatches
      .filter((hatch) => hatch.group === exit.group && hatch.id !== exit.id)
      .map((hatch) => ({ hatch, steps: findRoute(world.map, actor.pos, centerOf(hatch)) }))
      .filter((entry) => entry.steps !== null)
      .sort((a, b) => Math.hypot(a.hatch.x + 0.5 - actor.pos.x, a.hatch.y + 0.5 - actor.pos.y) - Math.hypot(b.hatch.x + 0.5 - actor.pos.x, b.hatch.y + 0.5 - actor.pos.y));
    const entry = entries[0];
    if (!entry) throw new RuleViolation('no_path', 'いまは、入れる抜け道がありません');
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
  if (task.kind === 'divine') {
    if (task.nearSince === null) return `${nameOf(world, task.targetId)} に近づいて、占おうとしている（そばに${world.roam.divineSeconds}秒いると占える）`;
    return `${nameOf(world, task.targetId)} のそばで、占っている（あと${Math.max(1, Math.ceil(world.roam.divineSeconds - (world.clock - task.nearSince)))}秒。離れると、はじめから）`;
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
  if (task.kind === 'report') return `ずんだ餅になった ${nameOf(world, task.targetId)} のそばへ、知らせに向かっている（すぐそばまで行くと、知らせて集会になる）`;
  if (task.kind === 'look') {
    const device = deviceOf(world, task.device) as DeviceDefinition;
    return task.until === null ? `${device.room} の「${device.name}」を見に向かっている` : `${device.room} の「${device.name}」を見ている`;
  }
  if (task.kind === 'sneak') {
    return task.until === null ? `${hatchOf(world, task.from).room} の抜け道へ向かっている` : `床下の抜け道を、${hatchOf(world, task.to).room} へ進んでいる`;
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
    self: { name: me.name, role: me.role, persona: me.persona, style: me.style, allies, bonds: me.bonds ?? [], ...(me.role === 'seer' ? { divined: [...(me.divined ?? [])] } : {}), ...(me.role === 'fox' && me.foxWork ? { foxWork: { ...me.foxWork } } : {}) },
    round: world.round,
    clock: Math.floor(world.clock),
    secondsUntilOpening: Math.max(0, Math.ceil(world.roam.roamSeconds - world.clock)),
    where: actor.under ? UNDER_FLOOR : areaAt(world.map, actor.pos),
    visible: visibleTo(world, id).map((other) => {
      const seen = actorById(world, other);
      const asleep = playerById(world, other).status === 'asleep';
      const looking = asleep ? null : lookingAt(world, seen);
      return { name: nameOf(world, other), where: areaAt(world.map, seen.pos), asleep, working: !asleep && isWorking(seen), ...(looking ? { checking: looking } : {}) };
    }),
    // 本家のように、何か所も回る仕込みの次の場所は、いまの工程を終えるまで分からない（終えた工程と、いまの工程だけを渡す。2026-11-21 から）
    // 仕込みを少しずつ出す試合では、いま見えていて、まだ終わっていない仕込みだけ（まだ出ていない仕込みは、数だけ。2026-11-21 夜から）
    duties: actor.duties
      .filter((duty) => world.roam.dutiesShown <= 0 || (duty.shown && duty.steps.some((step) => !step.done)))
      .map((duty) => {
        const next = duty.steps.findIndex((step) => !step.done);
        const shown = next < 0 ? duty.steps : duty.steps.slice(0, next + 1);
        return { name: duty.name, total: duty.steps.length, steps: shown.map((step) => ({ what: step.what, room: step.room, done: step.done })) };
      }),
    ...(world.roam.dutiesShown > 0 ? { dutiesWaiting: actor.duties.filter((duty) => !duty.shown).length } : {}),
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
    devices: (['admin', 'vitals', 'cameras'] as const).flatMap((kind) => {
      const device = deviceOf(world, kind);
      return device ? [{ kind, name: device.name, room: device.room }] : [];
    }),
    cameraView:
      actor.task?.kind === 'look' && actor.task.device === 'cameras' && actor.task.until !== null
        ? cameraPoints(world).map((camera) => ({
            place: camera.name,
            seen: cameraView(world, camera)
              .filter((other) => other !== id)
              .map((other) => ({ name: nameOf(world, other), asleep: playerById(world, other).status === 'asleep' })),
          }))
        : null,
    // 赤いランプのついた防犯カメラのうち、本人から見えているもの（ほかの誰かが画面を見ている）
    cameraLit: cameraWatchers(world).some((other) => other !== id)
      ? cameraPoints(world).filter((camera) => canSeePoint(world, actor, centerOf(camera))).map((camera) => camera.name)
      : [],
    events: [...actor.events],
    heard: actor.heard.map((h) => ({ ...h })),
    chatWaitSeconds: wait(actor.chatReadyAt),
    activity: describeTask(world, actor),
    idle: actor.task === null,
    lastResult: actor.lastResult,
    napCooldown: me.role === 'nibbler' ? Math.max(0, Math.ceil((world.napReadyAt[id] ?? 0) - world.clock)) : null,
    ...(actor.seer ? { divine: { usesLeft: actor.divinedRound === world.round ? 0 : 1 } } : {}),
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
    ...foxesOutOf(world),
    history: [...world.history],
  };
}

/** 意図を適用できなかったとき、その理由を本人の「直前の結果」に入れる。 */
export function noteRejection(world: RoamWorld, id: PlayerId, reason: string): void {
  actorById(world, id).lastResult = `できなかった: ${reason}`;
}
