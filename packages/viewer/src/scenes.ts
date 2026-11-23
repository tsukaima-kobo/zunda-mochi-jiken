// 上映の1コマを描く。どの時刻の絵も、その時刻だけから決まる（再生位置を動かしても同じ絵になる）。
//   見回り: 工房のマップ、名簿、開店までの時計
//   集会: 鐘の告知 → 話し合い → 投票（いっせいに開く）→ 結果
//   おしまい: 勝敗と、全員の役職

import type { MatchEvent } from '../../server/src/match-core.ts';
import { centerOf, hasLineOfSight, parseMap } from '../../sim/src/index.ts';
import type { GameMap } from '../../sim/src/index.ts';
import { displayText, mouthAt, revealedChars } from '../../speech/src/index.ts';
import { drawActor, drawPortrait, sparkle } from './actors.ts';
import { drawCutin } from './cutin.ts';
import { cameraMount, deviceSpot, drawCameraLamp, drawNameTags, drawScreensOn } from './devices.ts';
import { drawBust, hasPortrait } from './portraits.ts';
import { drawPlayNarration, pickBar } from './narrator-bar.ts';
import type { ActorLook, Mood } from './actors.ts';
import { ANCHOR_X, ANCHOR_Y, Director } from './director.ts';
import type { Camera } from './director.ts';
import { clockAt, DIVINE_CUE_SECONDS, doorRectsOf, FIRED, ghostsAt, isUp, posesAt, progressAt, roamClockAt, showTimeOf, shutRoomsAt, troubleAt } from './show.ts';
import type { ActorPose, Cue, DoorRect, EndingSegment, GhostPose, IntroSegment, MeetingSegment, RoamSegment, Segment, Show, ShutSpan, SneakSpan, TroubleSpan } from './show.ts';
import {
  brainLabel,
  drawBrainChip,
  plainThought,
  clamp01,
  clampLines,
  clockLabel,
  colorOf,
  drawTag,
  drawText,
  easeBack,
  ejectTruth,
  ejectVerdict,
  easeInOut,
  easeOut,
  H,
  hill,
  INK,
  MOCHI_INK,
  lerp,
  PAPER,
  PAPER_DARK,
  plaque,
  rand,
  ROLE_COLOR,
  ROLE_LABEL,
  ROLE_SHORT,
  ROLE_TAG,
  isOutsider,
  roundRect,
  setFont,
  SIDE_OF,
  SIGHT_TAG,
  W,
  WOOD,
  WOOD_DARK,
  wrapText,
  ZUNDA,
  ZUNDA_DARK,
  zundaMochi,
  fitText,
} from './theme.ts';
import type { CastColor, Ctx, Role, SightKind, TextFrame } from './theme.ts';
import { shownBrain } from './lineup.ts';
import { drawProp } from './props.ts';
import { buildWorkshop, drawAtmosphere, drawBell, drawHatch, drawMeetingRoom, drawShutDoor, sightPolygon } from './workshop.ts';
import type { Workshop } from './workshop.ts';

type EventOf<T extends MatchEvent['type']> = Extract<MatchEvent, { type: T }>;

/**
 * 集会の内心の雲に載せる文字の枠（雲の幅 THOUGHT_W から左右の余白 56 を引いた幅）。雲は上の真ん中に固定で、
 * 左の集会の札と右の地図のあいだに収める。長い内心は行を増やし、文字を少しずつ小さくする。全文を出し、切らない。
 */
const THOUGHT_W = 920;
export const THOUGHT_FRAMES: readonly TextFrame[] = [
  { width: THOUGHT_W - 56, size: 28, max: 3 },
  { width: THOUGHT_W - 56, size: 26, max: 4 },
  { width: THOUGHT_W - 56, size: 24, max: 5 },
  { width: THOUGHT_W - 56, size: 22, max: 6 },
];

export interface RenderOptions {
  /** 役職と内心（登場人物どうしには見えていない情報）を画面に出すか。 */
  secrets: boolean;
  /** 音声のクレジット（音声を付けた時だけ。使った声のぶん）。集会では、話している人の声のクレジットだけを出す。 */
  credits: string[];
  /** 見回りの映し方。auto: カメラの係に任せる / overview: いつも工房の全体を映す */
  camera?: 'auto' | 'overview';
  /** 見回りで、この人（名前）を映し続ける。2人なら一緒に映す（冒頭のダイジェストの、仲よしのやりとり）。 */
  focus?: string[];
  /** BGM のクレジット（BGM を入れた時だけ）。おしまいの画面に出す。 */
  music?: string[];
  /**
   * 場面の絵だけを描く（縦長の画面用）。上の帯・右の一覧・下の帯・字幕・内心・案内役の帯・鐘の告知・差し込みは描かない
   * （縦の画面に合わせて、呼ぶ側が描き直す）。登場人物・名札・投票の札・クビの紙は描く。
   */
  bare?: boolean;
  /** クビの場面の、紙と本人の置き場所（縦長の画面用。省くと、ふだんの横長の配置）。 */
  fired?: { paperX: number; paperY: number; actorX: number; actorY: number; actorScale: number };
}

interface Member {
  name: string;
  seat: number;
  color: CastColor;
  role: Role;
  persona: string;
  brain: string;
  /** 頭脳の記録上の名前（例: claude-cli:claude-haiku-5-5）。頭脳の札の色と呼び名に使う。 */
  brainId: string | null;
}

/** 集会の席（scale は人の大きさ、gap はとなりの席との間）。 */
interface Seat {
  member: Member;
  x: number;
  y: number;
  scale: number;
  gap: number;
}

interface Headline {
  at: number;
  text: string;
  /** 役職と内心を出さない時の言い方（無ければ text のまま）。 */
  plain?: string;
  alert: boolean;
  /** 役職と内心を出さない時は、出さない（抜け道の出入りなど）。 */
  secretOnly?: boolean;
}

/** 持ち場（仕込みの場所）と、困りごとを直す場所。 */
interface Spot {
  x: number;
  y: number;
  name: string;
  room: string;
  /** station: 仕込みの持ち場 / lights・crisis: その困りごとを直す場所 */
  kind: 'station' | 'lights' | 'crisis';
  /** そこで手を動かす時の向き（となりの家具のほう）。 */
  face: -1 | 1;
}

/** 持ち場で手を動かし続けていた間。 */
interface WorkSpan {
  start: number;
  end: number;
  x: number;
  y: number;
}

/** その時刻の、工房の様子（困りごと、閉まった戸、心だけの人）。 */
interface WorldNow {
  trouble: (TroubleSpan & { age: number; left: number | null }) | null;
  /** あかりの消え具合（0: ついている 〜 1: 消えている）。 */
  dark: number;
  shut: ShutSpan[];
  ghosts: (GhostPose | null)[];
}

/** マップの絵を作っておく細かさ（升目1つのピクセル数）。 */
const LAYER_TILE = 72;
/** 登場人物の大きさ（升目より少し大きく描く）。 */
const ACTOR_SCALE = (LAYER_TILE / 56) * 1.5;
/** 防犯カメラの映像の中の人の大きさ（ふつうの何倍か）。 */
const FEED_ACTOR = 1.6;
/** 餅に変わった時の札を出しておく秒数。 */
const SIGHT_TAG_SECONDS = 3.6;

/** 2点のあいだに壁が無いか（試合の hasLineOfSight と同じく、線を細かく刻んで升目を調べる）。 */
/** 集会の地図の置き場所（右下。話している人の字幕の右）。 */
/** 集会の右上の地図。下のふちは、端の席の頭（いちばん高い耳で y 350 ほど）より上に収める。 */
const MEETING_MAP = { x: 1456, y: 20, w: 440, h: 288 };
/** 集会の左上の札（集会の番号、その下に仕込みの進み具合）。 */
const MEETING_HEAD = { x: 30, y: 20, w: 400 };
/** 集会の左上、仕込みの札の下に並べる、ずんだ餅になった人の顔の大きさ（半径）と、札からの間。 */
const MOCHI_FACE = { r: 24, gap: 12 };

function clearLine(shop: Workshop, a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 0.2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (shop.wall(Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t))) return false;
  }
  return true;
}

/** 右の列（時計、見取り図、名簿）。 */
const RIGHT_X = 1500;
const RIGHT_W = 400;
const STRIP_Y = 942;
const STRIP_H = 118;
const BELL_FADE = 0.6;
/** 立っている人どうしが、これより近いと、絵の上で左右に分ける（マス）。 */
const SPREAD = 0.7;

/** 行動の相手を決めない時の target（記録の中の決まった語）。 */
const NO_TARGET = 'なし';
/** 妨害の target（記録の中の決まった語）。これ以外は、戸を閉める部屋の名前。 */
const SABOTAGE_TEXT: Record<string, string> = { あかり: 'あかりを消す', かまど: 'かまどを焚きすぎにする' };
const sabotageText = (target: string) => SABOTAGE_TEXT[target] ?? `${target}の戸を閉める`;
const ACTION_SHORT: Record<string, (target: string) => string> = {
  move_to: (target) => `${target}へ`,
  follow: (target) => `${target}を追う`,
  wait: () => 'ひとやすみ',
  report: () => '鐘を鳴らす！',
  transform: (target) => `${target}をねらう`,
  transform_if_unseen: (target) => `${target}をねらう…`,
  // 前の題材の記録（行動の名前が nap だった頃）
  nap: (target) => `${target}をねらう`,
  nap_if_unseen: (target) => `${target}をねらう…`,
  do_task: (target) => (target === NO_TARGET ? '仕込みへ' : `${target}へ`),
  fix: (target) => (target === NO_TARGET ? '直しに行く！' : `${target}へ急ぐ！`),
  call_meeting: () => '鐘を鳴らしに行く！',
  sneak: (target) => `抜け道で${target}へ`,
  sabotage: (target) => `${sabotageText(target)}…`,
  check: (target) => `${target}へ`,
  divine: (target) => `${target}を占う`,
};
const ACTION_LONG: Record<string, (target: string) => string> = {
  move_to: (target) => `${target}へ向かう`,
  follow: (target) => `${target}についていく`,
  wait: () => 'ひとやすみ',
  report: (target) => `ずんだ餅になった${target}を知らせる`,
  transform: (target) => `${target}をずんだ餅に変えに行く`,
  transform_if_unseen: (target) => `${target}を、こっそり餅に変えに行く`,
  nap: (target) => `${target}をずんだ餅に変えに行く`,
  nap_if_unseen: (target) => `${target}を、こっそり餅に変えに行く`,
  do_task: (target) => (target === NO_TARGET ? '仕込みを進める' : `仕込み: ${target}`),
  fix: (target) => (target === NO_TARGET ? '困りごとを直しに行く' : `${target}を直しに行く`),
  call_meeting: () => '中庭の鐘を鳴らしに行く',
  sneak: (target) => `床下の抜け道で${target}へ`,
  sabotage: (target) => `妨害: ${sabotageText(target)}`,
  check: (target) => `${target}を見に行く`,
  divine: (target) => `${target}に近づいて、占う`,
};
/** 手をかざす動き: 餅に変える何秒前から手を上げはじめるか・下ろすのにかける秒数。 */
const REACH_LEAD = 0.45;
const REACH_DOWN = 0.35;

/** ずんだの妖精だけが選べる行動（役職と内心を出さない時は、画面に出さない）。nap・nap_if_unseen は前の題材の記録。 */
const SECRET_ACTIONS = new Set(['transform', 'transform_if_unseen', 'nap', 'nap_if_unseen', 'sneak', 'sabotage', 'divine']);
const VERDICT_TEXT: Record<string, string> = { tie: '票が割れた', too_few: '票が集まらなかった', skip_wins: 'スキップが多かった' };
const COUNT_WORD = ['', 'ひとり', 'ふたり', '3人', '4人'];
/** おしまいの理由。妖精の人数で言い方が変わるものがある。 */
function whyText(why: string, nibblers: number): string {
  const many = nibblers > 1;
  switch (why) {
    case 'nibbler_sent_home':
      return many ? 'ずんだの妖精を、全員クビにした' : 'ずんだの妖精を、クビにした';
    case 'outnumbered':
      return many ? '起きている人間が、妖精と同じ人数まで減った' : '起きている人間が、ひとりだけになった';
    case 'opened':
      return '開店の時刻まで、工房を守りきった';
    case 'tasks_done':
      return '仕込みを、ぜんぶ終わらせた';
    case 'crisis':
      return 'かまどの焚きすぎを、止められなかった';
    case 'late':
      return '開店の時刻までに、仕込みが終わらなかった';
    default:
      return '';
  }
}
const TROUBLE_COLOR = { lights: '#3d3f7a', crisis: '#c0392b' } as const;

export class Stage {
  readonly show: Show;
  private readonly shop: Workshop | null;
  private readonly director: Director | null;
  /** 防犯カメラの映像で、壁の向こうを映さないための間取り。 */
  private readonly grid: GameMap | null;
  private camBoxes: { x0: number; y0: number; x1: number; y1: number; vertical: boolean }[] | null = null;
  private readonly members: Member[];
  private readonly byName = new Map<string, Member>();
  /** 集会の左上の札（集会の番号・仕込み・ずんだ餅になった人の顔）の下のふち。 */
  private meetingHeadBottom = MEETING_HEAD.y + 154;
  private readonly decides = new Map<string, Cue[]>();
  private readonly naps: Cue[] = [];
  /** 占い師が占った瞬間（上映の時刻の順）。 */
  private readonly divines: Cue[] = [];
  /** 妖精が狐に手をかざしたが、餅にならなかった（2026-11-21 から）。 */
  private readonly misses: Cue[] = [];
  /** 餅に変わった時の、まわりの人の札（餅の合図ごとに1回だけ求める）。 */
  private readonly sightTags = new Map<Cue, { seat: number; kind: SightKind }[]>();
  private readonly headlines: Headline[] = [];
  private readonly statusChanges: { at: number; name: string; status: 'z' | 'x' }[] = [];
  private readonly nibblers: Member[];
  private readonly madmen: Member[];
  private readonly foxes: Member[];
  private readonly tasks: Cue[] = [];
  /** 見回りの間の声（上映の時刻の順）。 */
  private readonly chats: Cue[] = [];
  private readonly spots: Spot[] = [];
  private readonly doorRects: Record<string, DoorRect[]> = {};
  private readonly works = new Map<number, WorkSpan[][]>();
  /** あかりが消えた時の暗がりを作る下絵（画面の半分の細かさ）。 */
  private darkLayer: HTMLCanvasElement | null = null;

  constructor(show: Show) {
    this.show = show;
    const { log } = show;
    this.members = log.seats.map((name, seat) => {
      const player = log.players.find((p) => p.name === name);
      return { name, seat, color: colorOf(name, seat), role: player?.role ?? 'artisan', persona: player?.persona ?? '', brain: brainLabel(shownBrain(name, player?.brain ?? null)), brainId: shownBrain(name, player?.brain ?? null) };
    });
    for (const member of this.members) this.byName.set(member.name, member);
    this.nibblers = this.members.filter((m) => m.role === 'nibbler');
    this.madmen = this.members.filter((m) => m.role === 'madman');
    this.foxes = this.members.filter((m) => m.role === 'fox');

    const map = log.roam?.map;
    this.shop = map ? buildWorkshop(map, LAYER_TILE) : null;
    this.grid = map?.devices?.cameras ? parseMap(map) : null;
    if (map) {
      // 手を動かす時は、いちばん近い家具のほうを向く
      const faceAt = (x: number, y: number): -1 | 1 => {
        let side: -1 | 1 = 1;
        let near = 2.2;
        for (const prop of this.shop?.props ?? []) {
          const cx = Math.min(prop.x + prop.w, Math.max(prop.x, x));
          const cy = Math.min(prop.y + prop.h, Math.max(prop.y, y));
          const d = Math.hypot(cx - x, cy - y);
          if (d >= near) continue;
          near = d;
          side = prop.x + prop.w / 2 < x ? -1 : 1;
        }
        return side;
      };
      for (const station of map.stations ?? []) this.spots.push({ x: station.x + 0.5, y: station.y + 0.5, name: station.name, room: station.room, kind: 'station', face: faceAt(station.x + 0.5, station.y + 0.5) });
      for (const point of map.fixPoints ?? []) this.spots.push({ x: point.x + 0.5, y: point.y + 0.5, name: point.name, room: point.room, kind: point.for, face: faceAt(point.x + 0.5, point.y + 0.5) });
      this.doorRects = doorRectsOf(map);
    }
    const hasTasks = (log.roam?.taskTotal ?? 0) > 0;
    const fixNames = (what: 'lights' | 'crisis') => this.spots.filter((spot) => spot.kind === what);
    let half = false;
    this.director = this.shop
      ? new Director(show, this.members.map((m) => ({ seat: m.seat, name: m.name, nibbler: m.role === 'nibbler' })), this.shop.cols, this.shop.rows, {
          rooms: Object.fromEntries(this.shop.rooms.map((room) => [room.name, { x: room.x + room.w / 2, y: room.y + room.h / 2 }])),
          fix: {
            lights: (map?.fixPoints ?? []).filter((point) => point.for === 'lights').map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 })),
            crisis: (map?.fixPoints ?? []).filter((point) => point.for === 'crisis').map((point) => ({ x: point.x + 0.5, y: point.y + 0.5 })),
          },
        })
      : null;

    for (const cue of show.cues) {
      const { event } = cue;
      if (event.type === 'decide') {
        const list = this.decides.get(event.agent) ?? [];
        list.push(cue);
        this.decides.set(event.agent, list);
        if (event.action === 'report' && event.applied) {
          // 餅のすぐそばまで歩いてから知らせる決まりの試合（2026-11-22 から）では、決めた時ではなく、知らせた時（見回りの終わり）に出す。
          // 途中でやめた時は出さない。その前の試合（決めた瞬間に知らせている）は、今までと同じ
          const index = show.segments.findIndex((s) => s.kind === 'roam' && cue.at >= s.start - 0.01 && cue.at <= s.end + 0.01);
          const roam = show.segments[index];
          const after = show.segments[index + 1];
          const told = roam?.kind === 'roam' ? roam.end - (roam.held ?? 0) : cue.at;
          const leads = after?.kind === 'meeting' && after.info.kind === 'report' && after.info.reporter === event.agent;
          if (told - cue.at <= 0.3) this.headlines.push({ at: cue.at, text: `${event.agent}が鐘を鳴らした！`, alert: true });
          else if (leads && !show.cues.some((c) => c.event.type === 'decide' && c.event.agent === event.agent && c.event.action === 'report' && c.event.applied && c.at > cue.at && c.at <= told)) this.headlines.push({ at: told, text: `${event.agent}が鐘を鳴らした！`, alert: true });
        }
      } else if (event.type === 'task') {
        this.tasks.push(cue);
        if (!event.pretend && !half && event.total > 0 && event.done * 2 >= event.total && event.done < event.total) {
          half = true;
          this.headlines.push({ at: cue.at, text: `仕込みが半分まで進んだ（${event.done}/${event.total}）`, alert: false });
        }
      } else if (event.type === 'sabotage') {
        if (event.what === 'lights') {
          const where = fixNames('lights').map((spot) => `${spot.room}の${spot.name}`).join('、');
          const how = where ? `　${where}で直せる` : '';
          this.headlines.push({ at: cue.at, text: `${event.by}が、工房のあかりを消した！${how}`, plain: `工房のあかりが消えた！${how}`, alert: true });
        } else if (event.what === 'crisis') {
          const where = fixNames('crisis').map((spot) => spot.name).join('と');
          const how = `　${event.seconds ?? 0}秒のうちに${where ? `、${where} を同時に押さえる` : '直す'}`;
          this.headlines.push({ at: cue.at, text: `${event.by}が、かまどを焚きすぎにした！${how}`, plain: `かまどが焚きすぎだ！${how}`, alert: true });
        } else {
          this.headlines.push({ at: cue.at, text: `${event.by}が、${event.room ?? ''}の戸を閉めた！`, plain: `${event.room ?? ''}の戸が、ぴしゃりと閉まった！`, alert: true });
        }
      } else if (event.type === 'fixed') {
        const who = event.by.join('と');
        this.headlines.push({ at: cue.at, text: event.what === 'lights' ? `${who}がブレーカーを上げて、あかりが戻った` : `${who}が、かまどを落ち着かせた！`, alert: false });
      } else if (event.type === 'sneak') {
        // 仲間の妖精は、見ていても困らないので数えない
        const eyes = event.witnesses.filter((name) => this.byName.get(name)?.role !== 'nibbler');
        const seen = eyes.length > 0 ? `　見ていた人: ${eyes.join('、')}` : '';
        this.headlines.push({ at: cue.at, text: event.phase === 'in' ? `${event.by}が、${event.room}の揚げ板から床下へもぐった${seen}` : `${event.by}が、${event.room}の揚げ板から出てきた${seen}`, alert: false, secretOnly: true });
      } else if (event.type === 'bell') {
        // 鐘は見回りの最後の瞬間に鳴るので、告知の間も読めるように、ほんの少し手前に置く
        this.headlines.push({ at: cue.at - 0.05, text: `${event.by}が、中庭の鐘を鳴らした！`, alert: true });
      } else if (event.type === 'look' && event.phase === 'start') {
        const device = log.roam?.map.devices?.[event.device];
        if (device) this.headlines.push({ at: cue.at, text: `${event.agent}が、${device.room}の「${device.name}」を${event.device === 'cameras' ? 'のぞいている' : '見ている'}`, alert: false });
      } else if (event.type === 'chat') {
        this.chats.push(cue);
      } else if (event.type === 'nap') {
        this.naps.push(cue);
        this.statusChanges.push({ at: cue.at, name: event.target, status: 'z' });
        const seen = event.witnesses.map((w) => `${w.name}${w.sawWho ? '' : '（誰が変えたかは見えず）'}`);
        this.headlines.push({
          at: cue.at,
          text: `${event.by}が${event.room}で${event.target}を ずんだ餅に変えた！　${seen.length > 0 ? `見ていた人: ${seen.join('、')}` : '誰も見ていない…'}`,
          plain: `${event.room}で${event.target}が ずんだ餅になってしまった…`,
          alert: true,
        });
      } else if (event.type === 'nap_failed') {
        // 狐には、妖精の手が効かない。誰が妖精で誰が狐かが分かる知らせなので、役職を見せている時だけ
        this.misses.push(cue);
        const seen = event.witnesses.map((w) => w.name);
        this.headlines.push({
          at: cue.at,
          text: `妖精の${event.by}が、狐の${event.target}に手をかざした！　でも、狐には効かない！　${seen.length > 0 ? `見ていた人: ${seen.join('、')}` : '誰も見ていない…'}`,
          alert: true,
          secretOnly: true,
        });
      } else if (event.type === 'divine') {
        this.divines.push(cue);
        if (event.cursed) {
          // 占われた狐は、その場で餅になる。役職を隠している時は、誰が占ったかを出さない
          this.statusChanges.push({ at: cue.at, name: event.target, status: 'z' });
          const seen = event.witnesses.map((w) => w.name);
          this.headlines.push({
            at: cue.at,
            text: `占い師の${event.by}が占うと、狐の${event.target}が ずんだ餅に変わった！　${seen.length > 0 ? `見ていた人: ${seen.join('、')}` : '誰も見ていない…'}`,
            plain: `${event.room}で${event.target}が、急に ずんだ餅になってしまった…`,
            alert: true,
          });
        } else {
          this.headlines.push({ at: cue.at, text: `占い師の${event.by}が、${event.target}を占った！　結果: ${event.fairy ? '妖精だった！' : '妖精ではなかった'}`, alert: event.fairy, secretOnly: true });
        }
      } else if (event.type === 'round_start') {
        const first = hasTasks ? '夜明け前の工房。ずんだの妖精に気をつけながら、仕込みを終えよう' : '夜明け前の工房。開店まで、ずんだの妖精から工房を守れるか？';
        this.headlines.push({ at: cue.at, text: event.round === 1 ? first : `${event.round}回目の見回りが始まった`, alert: false });
      } else if (event.type === 'meeting_end') {
        if (event.ejected) this.statusChanges.push({ at: cue.at + 1.6, name: event.ejected, status: 'x' });
      }
    }
    // 重なりすぎて後ろへずらせなかった声は、もとの時刻のまま入っているので、並べ直す
    this.chats.sort((a, b) => a.at - b.at);
  }

  /** 1コマ描く。ctx は横 1920 × 縦 1080 の座標になっていること。 */
  draw(ctx: Ctx, time: number, options: RenderOptions): void {
    const { segments } = this.show;
    const index = Math.max(0, segments.findIndex((s) => time >= s.start && time < s.end));
    const segment = segments[index] ?? segments.at(-1);
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    if (!segment) {
      this.drawNotice(ctx, 'この記録には、上映できる場面がありません');
    } else if (segment.kind === 'intro') {
      this.drawIntro(ctx, segment, time, options);
      this.wash(ctx, (time - (segment.end - 0.4)) / 0.4);
    } else if (segment.kind === 'roam') {
      this.drawRoam(ctx, segment, time, time, options);
      // 前の場面から移った時は、ふわっと明るくなって始まる
      if (index > 0) this.wash(ctx, 1 - (time - segment.start) / 0.5);
    } else if (segment.kind === 'meeting') {
      const local = time - segment.start;
      const bell = segment.talkStart - segment.start;
      const before = segments[index - 1];
      if (local < bell && before?.kind === 'roam') {
        this.drawRoam(ctx, before, before.end - 0.0001, time, options);
        if (!options.bare) this.drawBellOverlay(ctx, segment, local);
        const fade = clamp01((local - (bell - BELL_FADE)) / BELL_FADE);
        if (fade > 0) {
          ctx.save();
          ctx.globalAlpha = easeInOut(fade);
          this.drawMeeting(ctx, segment, time, options);
          ctx.restore();
        }
      } else {
        this.drawMeeting(ctx, segment, time, options);
        if (segments[index + 1]?.kind === 'roam') this.wash(ctx, (time - (segment.end - 0.4)) / 0.4);
      }
    } else {
      this.drawEnding(ctx, segment, time, options);
    }
    // 案内役の一言（下の帯に重ねる）。役職を明かす一言は、役職を見せている時だけ
    // 続けて話す一言の間は、帯を出したままにする
    const picked = pickBar(this.show.callouts.filter((c) => c.voiced && (!c.secret || options.secrets)), time);
    if (picked && !options.bare) drawPlayNarration(ctx, { at: picked.item.at, end: picked.item.end, text: picked.item.text, clip: picked.item.clip ?? null }, time, picked);
    ctx.restore();
  }

  // ───────── 縦長の画面から使うもの ─────────

  /** 餅に変える直前の差し込みを描く（役職を見せている時の見せ場）。area は、暗がりと白い光で塗る範囲（省くと画面全体）。 */
  drawCutins(ctx: Ctx, poseTime: number, time: number, area?: { x: number; y: number; w: number; h: number }): void {
    for (const cut of this.show.cutins) {
      if (poseTime < cut.at || poseTime > cut.end + 1) continue;
      const person = (member: Member) => ({ name: member.name, look: this.look(member, time), brain: member.brainId });
      const pairs = cut.pairs.flatMap((pair) => {
        const by = this.byName.get(pair.by);
        const target = this.byName.get(pair.target);
        return by && target ? [{ by: person(by), target: person(target) }] : [];
      });
      drawCutin(ctx, cut, poseTime, pairs, area);
    }
  }

  /** その集会での、その人の席（画面の中の位置）。出ていない人は null。 */
  seatIn(meeting: number, name: string): { x: number; y: number; scale: number } | null {
    const segment = this.show.segments.find((s): s is MeetingSegment => s.kind === 'meeting' && s.info.meeting === meeting);
    const seat = segment ? this.seatsOf(segment).find((s) => s.member.name === name) : undefined;
    return seat ? { x: seat.x, y: seat.y, scale: seat.scale } : null;
  }

  /** 登場人物の見た目・頭脳の札・役（縦長の画面の紹介で使う）。 */
  castOf(name: string, time: number): { look: Pick<ActorLook, 'color' | 'style' | 'time' | 'seed' | 'character'>; brain: string | null; role: Role } | null {
    const member = this.byName.get(name);
    return member ? { look: this.look(member, time), brain: member.brainId, role: member.role } : null;
  }

  // ───────── 共通 ─────────

  private wash(ctx: Ctx, amount: number): void {
    const k = clamp01(amount);
    if (k <= 0) return;
    ctx.save();
    ctx.globalAlpha = k;
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
  }

  private drawNotice(ctx: Ctx, text: string): void {
    this.drawBackdrop(ctx);
    drawText(ctx, text, W / 2, H / 2, { size: 44, align: 'center' });
  }

  /** 画面の地（和紙の色に、うすい格子）。 */
  private drawBackdrop(ctx: Ctx): void {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#f6ecd2');
    g.addColorStop(1, '#ead9b2');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.globalAlpha = 0.07;
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 2;
    for (let x = -H; x < W; x += 46) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x + H, H);
      ctx.moveTo(x + H, 0);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.restore();
  }

  private statusAt(time: number): Map<string, 'z' | 'x'> {
    const status = new Map<string, 'z' | 'x'>();
    for (const change of this.statusChanges) if (change.at <= time) status.set(change.name, change.status);
    return status;
  }

  /** その人が餅に変わった瞬間（妖精に変えられた時か、占われた狐）。 */
  private fallOf(name: string): Cue | undefined {
    return this.naps.find((cue) => (cue.event as EventOf<'nap'>).target === name) ?? this.divines.find((cue) => (cue.event as EventOf<'divine'>).cursed && (cue.event as EventOf<'divine'>).target === name);
  }

  private lastDecide(name: string, time: number, from: number): EventOf<'decide'> | null {
    const list = this.decides.get(name) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const cue = list[i] as Cue;
      if (cue.at <= time) return cue.at >= from ? (cue.event as EventOf<'decide'>) : null;
    }
    return null;
  }

  private look(member: Member, time: number): Pick<ActorLook, 'color' | 'style' | 'time' | 'seed' | 'character'> {
    return { color: member.color, style: member.seat, time, seed: member.seat * 3.1 + 1, character: member.name };
  }

  // ───────── 見回り ─────────

  /**
   * 仕込みが「ふり」の役か。妖精と妖精マニアは、いつも「ふり」。狐は、横取りに仕込みの条件の無い試合だけ「ふり」
   * （条件のある試合では、狐の仕込みは自分の条件のぶんだけ進む。2026-11-21 から）。占い師の仕込みは本物。
   */
  private fakeWork(role: Role): boolean {
    if (role === 'fox') return (this.show.log.roam?.config.foxSteps ?? 0) === 0;
    return isOutsider(role);
  }

  /** 行動の呼び名。妖精と妖精マニアの仕込みは「ふり」なので、役職を見せている時はそう書く。 */
  private actionText(event: EventOf<'decide'>, long: boolean, secrets: boolean): string {
    const role = this.byName.get(event.agent)?.role;
    if (event.action === 'do_task' && secrets && role !== undefined && this.fakeWork(role)) {
      if (!long) return '仕込みのふり';
      return event.target === NO_TARGET ? '仕込みのふりをする' : `仕込みのふり: ${event.target}`;
    }
    return ((long ? ACTION_LONG : ACTION_SHORT)[event.action] ?? (() => event.action))(event.target);
  }

  /** その位置にある持ち場（無ければ null）。 */
  private spotAt(x: number, y: number): Spot | null {
    let best: Spot | null = null;
    let near = 0.8;
    for (const spot of this.spots) {
      const d = Math.hypot(spot.x - x, spot.y - y);
      if (d >= near) continue;
      best = spot;
      near = d;
    }
    return best;
  }

  /** その人が、その時刻に続けている手仕事（持ち場に着いてから、離れるまで）。 */
  private workAt(segment: RoamSegment, seat: number, time: number): WorkSpan | null {
    let all = this.works.get(segment.start);
    if (!all) {
      const step = this.show.log.roam?.config.tickSeconds ?? 0.2;
      const built: WorkSpan[][] = this.members.map(() => []);
      segment.frames.forEach((frame, index) => {
        // 声が詰まっている所では絵をゆっくり流すので、コマの上映の時刻は、試合の時計から求める
        const at = showTimeOf(segment, segment.clock0 + index * step);
        const next = showTimeOf(segment, segment.clock0 + (index + 1) * step);
        for (let i = 0; i < built.length; i++) {
          if (frame.st[i] !== 'w') continue;
          const x = frame.pos[i * 2] ?? 0;
          const y = frame.pos[i * 2 + 1] ?? 0;
          const list = built[i] as WorkSpan[];
          const last = list.at(-1);
          if (last && at - last.end < step * 0.5 && Math.hypot(last.x - x, last.y - y) < 0.3) last.end = next;
          else list.push({ start: at, end: next, x, y });
        }
      });
      all = built;
      this.works.set(segment.start, all);
    }
    for (const span of all[seat] ?? []) if (time >= span.start && time < span.end) return span;
    return null;
  }

  /** あかりの消え具合（0〜1）。消える時は、ちらついてから落ちる。直ると、ふわっと戻る。 */
  private lightsLevel(time: number): number {
    let level = 0;
    for (const span of this.show.troubles) {
      if (span.what !== 'lights' || time < span.start || time > span.end + 0.8) continue;
      const up = clamp01((time - span.start) / 0.7);
      const flicker = up < 1 && Math.sin(time * 47) < 0.2 ? 0.5 : 1;
      const down = time <= span.end ? 1 : 1 - clamp01((time - span.end) / 0.8);
      level = Math.max(level, easeOut(up) * flicker * down);
    }
    return level;
  }

  private drawRoam(ctx: Ctx, segment: RoamSegment, poseTime: number, time: number, options: RenderOptions): void {
    const clock = clockAt(this.show, poseTime);
    const daylight = this.show.opening > 0 ? clamp01(clock / this.show.opening) : 1;
    const scene = `${segment.round}回目の見回り`;
    if (!this.shop || !this.director) {
      this.drawBackdrop(ctx);
      this.drawTopBar(ctx, scene, poseTime);
      return;
    }
    const poses = posesAt(this.show, segment, poseTime);
    const now: WorldNow = { trouble: troubleAt(this.show, poseTime), dark: this.lightsLevel(poseTime), shut: shutRoomsAt(this.show, poseTime), ghosts: ghostsAt(this.show, segment, poseTime) };
    const seats = (options.focus ?? []).map((name) => this.show.log.seats.indexOf(name));
    const camera =
      options.camera === 'overview'
        ? this.director.overview(segment)
        : seats.length > 0 && seats.every((seat) => seat >= 0)
          ? this.director.focusCamera(segment, seats[0] as number, seats[1] ?? null, poseTime)
          : this.director.cameraAt(segment, poseTime, options.secrets);
    this.drawWorld(ctx, this.shop, segment, poses, now, poseTime, time, daylight, options, camera);
    if (options.bare) return;
    this.drawTopBar(ctx, scene, poseTime);
    this.drawTrouble(ctx, now, poses, poseTime, time, options);
    if (this.show.log.roam?.config.deadline !== 0) this.drawClock(ctx, clock);
    else this.drawTimer(ctx, clock);
    const castTop = this.drawMini(ctx, this.shop, poses, now, camera, poseTime, time, options);
    this.drawCast(ctx, segment, poses, now, poseTime, time, options, camera.subject, castTop);
    this.drawStrip(ctx, segment, poseTime, time, options, camera);
    this.drawChatLine(ctx, segment, poseTime, time);
    this.drawLookPanel(ctx, segment, poses, camera, poseTime, time);
    // 餅に変える直前の見せ場（役職を見せている時だけ。画面のいちばん上に描く）
    if (options.secrets) this.drawCutins(ctx, poseTime, time);
  }

  /** いま鳴っている見回りの声の字幕（下の帯の上）。誰に聞こえたかも、小さく出す。 */
  private drawChatLine(ctx: Ctx, segment: RoamSegment, poseTime: number, time: number): void {
    let cue: Cue | null = null;
    for (const c of this.chats) {
      if (c.at > poseTime) break;
      if (c.voiced && c.end > poseTime && c.at >= segment.start - 0.01) cue = c;
    }
    if (!cue) return;
    const event = cue.event as EventOf<'chat'>;
    const member = this.byName.get(event.speaker);
    if (!member) return;
    const local = poseTime - cue.at;
    const length = cue.end - cue.at;
    const bx = 150;
    const bw = RIGHT_X - 60 - bx;
    const bh = 100;
    const by = STRIP_Y - bh - 26;
    const enter = easeOut(local / 0.2);
    ctx.save();
    ctx.globalAlpha = Math.min(enter, clamp01((length - local) / 0.2 + 0.3));
    ctx.translate(0, (1 - enter) * 14);
    plaque(ctx, bx, by, bw, bh, { radius: 24, fill: 'rgba(255, 253, 246, 0.96)', edge: member.color.dark });
    drawPortrait(ctx, bx + 52, by + bh / 2, 36, { ...this.look(member, time), mood: 'normal' });
    setFont(ctx, 26, 800);
    const nw = ctx.measureText(member.name).width + 36;
    roundRect(ctx, bx + 100, by - 20, nw, 42, 21);
    ctx.fillStyle = member.color.main;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = member.color.dark;
    ctx.stroke();
    drawText(ctx, member.name, bx + 100 + nw / 2, by + 1, { size: 26, color: '#fff', align: 'center', weight: 800, stroke: member.color.dark, strokeWidth: 4 });
    const chip = drawBrainChip(ctx, bx + 100 + nw + 10, by + 1, member.brainId, 20);
    const heard = event.heard.length > 0 ? `聞こえたのは${event.heard.join('・')}` : 'まわりには誰もいない';
    drawText(ctx, heard, bx + 100 + nw + 10 + chip + 14, by + 1, { size: 22, color: '#fff', weight: 700, stroke: '#3f2512', strokeWidth: 5 });
    const size = 36;
    const all = clampLines(wrapText(ctx, displayText(event.say), bw - 140, size, 700), 2);
    const total = all.reduce((sum, line) => sum + [...line].length, 0);
    const spoken = cue.clip ? cue.clip.seconds * 0.96 : length * 0.78;
    let budget = revealedChars(total, local, cue.clip?.phrases, spoken);
    const top = by + bh / 2 + 8 - ((all.length - 1) * (size + 8)) / 2;
    all.forEach((line, n) => {
      const chars = [...line];
      const shown = chars.slice(0, Math.max(0, budget)).join('');
      budget -= chars.length;
      if (shown) drawText(ctx, shown, bx + 104, top + n * (size + 8), { size, weight: 700 });
    });
    ctx.restore();
  }

  /** 工房の中。カメラの位置と近さに合わせて、マップ・家具・登場人物を描く。 */
  private drawWorld(ctx: Ctx, shop: Workshop, segment: RoamSegment, poses: ActorPose[], now: WorldNow, poseTime: number, time: number, daylight: number, options: RenderOptions, camera: Camera): void {
    const tile = shop.tile;
    // 足どりは試合の中の時計で動かす（声が詰まって絵をゆっくり流す所では、歩みも遅くなる）
    const pace = roamClockAt(segment, poseTime);
    const k = camera.zoom / tile; // 画面のピクセル ÷ マップの絵のピクセル
    const ox = ANCHOR_X - camera.x * camera.zoom;
    const oy = ANCHOR_Y - camera.y * camera.zoom;
    const view = { x0: -ox / k, y0: -oy / k, x1: (W - ox) / k, y1: (H - oy) / k };
    /** 同じ所に立っている人どうしを、絵の上だけ左右へずらす量（マス）。見える範囲などの計算には使わない。 */
    const nudge = new Map<object, number>();
    const px = (pose: { x: number; y: number }) => ({ x: (pose.x + (nudge.get(pose) ?? 0)) * tile, y: pose.y * tile + tile * 0.3 });
    const inView = (x: number, y: number, pad: number) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;
    const inSegment = (cue: { at: number }) => cue.at >= segment.start - 0.01 && cue.at <= segment.end + 0.01;
    const config = this.show.log.roam?.config;
    const vision = config?.visionRadius ?? 6;
    const dim = config?.lightsVision ?? 0.35;
    const { trouble } = now;
    const fixSpots = trouble ? this.spots.filter((spot) => spot.kind === trouble.what) : [];
    const heldAt = (spot: Spot) => poses.some((pose) => pose.state === 'w' && Math.hypot(pose.x - spot.x, pose.y - spot.y) < 0.8);
    /** 床下の抜け道を使っている間と、その前後（役職を見せている時だけ絵にする）。 */
    const sneaks = options.secrets ? this.show.sneaks.filter((span) => inSegment({ at: span.start }) && poseTime > span.start - 0.5 && poseTime < span.end + 0.8) : [];

    let nap: Cue | null = null;
    for (const cue of this.naps) {
      if (poseTime < cue.at - 0.3 || poseTime > cue.end + 0.7 || !inSegment(cue)) continue;
      nap = cue;
    }
    const napEvent = nap ? (nap.event as EventOf<'nap'>) : null;
    const napK = nap ? (poseTime - nap.at) / (nap.end - nap.at) : -1;
    // 占いの瞬間（占った人・占われた人・結果）。占われた狐は、その場で餅になる
    let divined: Cue | null = null;
    for (const cue of this.divines) {
      if (poseTime < cue.at - 0.6 || poseTime > cue.end + 0.9 || !inSegment(cue)) continue;
      divined = cue;
    }
    const divineEvent = divined ? (divined.event as EventOf<'divine'>) : null;
    // 光と輪は、いつも同じ速さ。結果の札だけ、案内役が言い終わるまで出しておく（divineHold: 延ばしたぶん）
    const divineK = divined ? (poseTime - divined.at) / DIVINE_CUE_SECONDS : -1;
    const divineHold = divined ? Math.max(0, (divined.end - divined.at) / DIVINE_CUE_SECONDS - 1) : 0;

    // 工房の外（夜明け前の暗がり）
    ctx.fillStyle = '#1d140c';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    const sx = Math.max(0, Math.floor(view.x0));
    const sy = Math.max(0, Math.floor(view.y0));
    const sw = Math.min(shop.width, Math.ceil(view.x1)) - sx;
    const sh = Math.min(shop.height, Math.ceil(view.y1)) - sy;
    if (sw > 0 && sh > 0) ctx.drawImage(shop.layer, sx, sy, sw, sh, sx, sy, sw, sh);
    this.drawDevicesNow(ctx, tile, poseTime, time, inView);

    // ずんだ餅に変わった場所に、ずんだ色の輪
    if (nap && napEvent && napK >= 0 && napK <= 1.4) {
      const target = poses[this.byName.get(napEvent.target)?.seat ?? -1];
      if (target) {
        const at = px(target);
        for (let ring = 0; ring < 3; ring++) {
          const r = clamp01(napK * 1.1 - ring * 0.16);
          if (r <= 0 || r >= 1) continue;
          ctx.beginPath();
          ctx.ellipse(at.x, at.y - tile * 0.2, tile * (0.3 + r * 1.5), tile * (0.22 + r * 1.05), 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(122, 176, 58, ${(1 - r) * 0.8})`;
          ctx.lineWidth = 7 * (1 - r) + 1;
          ctx.stroke();
        }
      }
    }

    // 占われた人の足もとに、むらさきの輪（占ったことは、まわりの人には見えないので、役職を見せている時だけ。狐が餅になる時は、どちらでも出す）
    if (divineEvent && divineK >= 0 && divineK <= 1.4 && (options.secrets || divineEvent.cursed)) {
      const target = poses[this.byName.get(divineEvent.target)?.seat ?? -1];
      if (target) {
        const at = px(target);
        for (let ring = 0; ring < 3; ring++) {
          const r = clamp01(divineK * 1.1 - ring * 0.16);
          if (r <= 0 || r >= 1) continue;
          ctx.beginPath();
          ctx.ellipse(at.x, at.y - tile * 0.2, tile * (0.3 + r * 1.5), tile * (0.22 + r * 1.05), 0, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(${divineEvent.cursed && !options.secrets ? '122, 176, 58' : '151, 117, 250'}, ${(1 - r) * 0.85})`;
          ctx.lineWidth = 7 * (1 - r) + 1;
          ctx.stroke();
        }
      }
    }

    // 困りごとを直す場所の、床の輪（誰かが押さえていれば緑）
    for (const spot of fixSpots) {
      const cx = spot.x * tile;
      const cy = spot.y * tile + tile * 0.1;
      if (!inView(cx, cy, tile * 2)) continue;
      const held = heldAt(spot);
      const tone = held ? '74, 168, 79' : trouble?.what === 'crisis' ? '214, 58, 47' : '240, 180, 40';
      for (let ring = 0; ring < 2; ring++) {
        const r = (time * 0.9 + ring / 2) % 1;
        ctx.beginPath();
        ctx.ellipse(cx, cy, tile * (0.42 + r * 0.7), tile * (0.3 + r * 0.5), 0, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${tone}, ${(1 - r) * 0.9})`;
        ctx.lineWidth = 6 * (1 - r) + 2;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.ellipse(cx, cy, tile * 0.42, tile * 0.3, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${tone}, 0.3)`;
      ctx.fill();
    }

    // 抜け道の揚げ板が開く（入る時と、出る時）
    for (const span of sneaks) {
      const lid = (at: number) => hill((poseTime - (at - 0.4)) / 1.1, 0.25);
      const into = lid(span.start);
      if (into > 0) drawHatch(ctx, span.from.x * tile, span.from.y * tile, tile, into);
      const out = span.to ? lid(span.end) : 0;
      if (span.to && out > 0) drawHatch(ctx, span.to.x * tile, span.to.y * tile, tile, out);
    }

    // 家具・戸・登場人物を、奥から手前へ（ずんだ餅になった人は床に低いので、少し先に描く）
    const actors = this.members
      .map((member) => ({ member, pose: poses[member.seat] }))
      .filter((entry): entry is { member: Member; pose: ActorPose } => entry.pose !== undefined && entry.pose.state !== 'x' && entry.pose.state !== 'u');
    const dreamers = this.members
      .map((member) => ({ member, ghost: now.ghosts[member.seat] ?? null }))
      .filter((entry): entry is { member: Member; ghost: GhostPose } => entry.ghost !== null);
    // 記録では、同じ持ち場に何人も重なって立つ。重なった人どうしを、近さに応じてなめらかに左右へ分ける
    // （起きている人どうし、心だけの人どうしで分ける。心だけの姿は透けているので、起きている人とは重なってよい）
    const spread = (group: { x: number; y: number }[]) => {
      for (const [i, a] of group.entries()) {
        for (const b of group.slice(i + 1)) {
          const d = Math.hypot(b.x - a.x, b.y - a.y);
          if (d >= SPREAD) continue;
          // 真上に重なった時は、名簿の順に左から。左右にずれていれば、その向きへ
          const side = Math.max(-1, Math.min(1, (b.x - a.x + 0.15) / 0.15));
          const push = ((SPREAD - d) / 2) * side;
          nudge.set(a, (nudge.get(a) ?? 0) - push);
          nudge.set(b, (nudge.get(b) ?? 0) + push);
        }
      }
    };
    spread(actors.filter((entry) => entry.pose.state !== 'z').map((entry) => entry.pose));
    spread(dreamers.map((entry) => entry.ghost));
    /** 心だけの姿は、餅に変わって少ししてから、ふわっと現れる。 */
    const dreamAlpha = (name: string) => {
      const fell = this.fallOf(name);
      return fell ? clamp01((poseTime - fell.at - 1.3) / 0.9) : 1;
    };
    const drawables: { base: number; draw: () => void }[] = [];
    for (const prop of shop.props) {
      const left = prop.x * tile;
      const top = prop.y * tile;
      if (left > view.x1 + tile || left + prop.w * tile < view.x0 - tile || top > view.y1 + tile * 2.5 || top + prop.h * tile < view.y0 - tile) continue;
      drawables.push({ base: (prop.y + prop.h) * tile - tile * 0.12, draw: () => drawProp(ctx, prop, tile, time) });
    }
    // 閉まった戸（閉まる時と開く時は、板戸がすべる）
    const closed = new Set<number>();
    for (const span of this.show.shuts) {
      if (poseTime < span.start || poseTime > span.end + 0.3) continue;
      const amount = poseTime < span.end ? easeOut((poseTime - span.start) / 0.22) : 1 - easeOut((poseTime - span.end) / 0.3);
      for (const door of this.doorRects[span.room] ?? []) {
        if (poseTime < span.end) for (let y = door.y; y < door.y + door.h; y++) for (let x = door.x; x < door.x + door.w; x++) closed.add(y * shop.cols + x);
        if (!inView((door.x + door.w / 2) * tile, (door.y + door.h / 2) * tile, tile * 3)) continue;
        drawables.push({ base: (door.y + door.h) * tile - tile * 0.05, draw: () => drawShutDoor(ctx, door, tile, amount) });
      }
    }
    const worried = trouble !== null && trouble.age > 0.5;
    for (const { member, pose } of actors) {
      const at = px(pose);
      let mood: Mood = worried ? 'worried' : 'normal';
      const intent = this.lastDecide(member.name, poseTime, segment.start);
      if (options.secrets && member.role === 'nibbler' && (worried || (intent && SECRET_ACTIONS.has(intent.action)))) mood = 'sly';
      if (options.secrets && member.role === 'madman' && worried) mood = 'sly';
      if (napEvent && napK >= 0 && napK <= 1 && options.secrets) {
        if (napEvent.witnesses.some((w) => w.name === member.name)) mood = 'shock';
        if (napEvent.by === member.name) mood = 'sly';
      }
      // 占われた狐が餅になるのを見た人は、おどろく
      if (divineEvent?.cursed && divineK >= 0 && divineK <= 1 && options.secrets && divineEvent.witnesses.some((w) => w.name === member.name)) mood = 'shock';
      const working = pose.state === 'w';
      const spot = working ? this.spotAt(pose.x, pose.y) : null;
      // 抜け道から出てきた時は、ぴょこんと出る
      const out = sneaks.find((span) => span.seat === member.seat && span.to !== null && poseTime >= span.end);
      const pop = out ? easeBack((poseTime - out.end) / 0.35) : 1;
      let facing: -1 | 1 = working ? (spot?.face ?? 1) : pose.dx < -0.001 ? -1 : 1;
      // 手をかざす動き（役職を見せている時だけ）。餅に変える少し前から手を上げ、変わったあとに下ろす。狐に効かなかった時も、同じように上げる
      let reach: { side: -1 | 1; k: number } | undefined;
      if (options.secrets && isUp(pose)) {
        const aim = (targetName: string, local: number, hold: number) => {
          const target = poses[this.byName.get(targetName)?.seat ?? -1];
          if (!target || local < -REACH_LEAD || local > hold + REACH_DOWN) return;
          const k = local < 0 ? easeOut((local + REACH_LEAD) / REACH_LEAD) : local <= hold ? 1 : 1 - clamp01((local - hold) / REACH_DOWN);
          const side: -1 | 1 = Math.abs(target.x - pose.x) < 0.05 ? facing : target.x < pose.x ? -1 : 1;
          reach = { side, k };
          facing = side;
        };
        if (nap && napEvent && napEvent.by === member.name) aim(napEvent.target, poseTime - nap.at, Math.min(0.7, (nap.end - nap.at) * 0.6));
        for (const cue of this.misses) {
          const miss = cue.event as EventOf<'nap_failed'>;
          if (miss.by === member.name && inSegment(cue)) aim(miss.target, poseTime - cue.at, 0.7);
        }
      }
      // ずんだ餅に変わった瞬間は、ぽよんと弾んで現れる
      const fell = pose.state === 'z' ? this.fallOf(member.name) : undefined;
      const morph = fell && poseTime - fell.at < 0.5 ? 0.25 + 0.75 * easeBack((poseTime - fell.at) / 0.45) : 1;
      const wings = options.secrets && member.role === 'nibbler';
      const tail = options.secrets && member.role === 'fox';
      const orb = options.secrets && member.role === 'seer';
      // 変わったばかりの餅は、変えた妖精と重なっていても見えるよう、手前に描く
      const fresh = fell !== undefined && poseTime - fell.at < 1.2;
      // 声を出している間は、口を動かす
      const chat = isUp(pose) ? this.activeChat(member.name, poseTime, segment) : null;
      const talk = chat ? this.mouthOf(chat, poseTime) : 0;
      drawables.push({
        base: at.y + (pose.state === 'z' ? (fresh ? tile * 0.3 : -tile * 0.4) : 0),
        draw: () => drawActor(ctx, { ...this.look(member, time), pace, x: at.x, y: at.y, scale: ACTOR_SCALE * pop * morph, facing, walking: pose.moving, working: working && !reach, asleep: pose.state === 'z', mood, wings, tail, orb, talk, ...(reach ? { reach } : {}) }),
      });
    }
    // 抜け道へ入る人は、揚げ板の穴へ沈んでいく
    for (const span of sneaks) {
      const sink = (poseTime - span.start) / 0.4;
      const member = this.members[span.seat];
      if (!member || sink < 0 || sink >= 1) continue;
      const at = px(span.from);
      drawables.push({
        base: at.y,
        draw: () => drawActor(ctx, { ...this.look(member, time), x: at.x, y: at.y - tile * 0.1 + sink * tile * 0.25, scale: ACTOR_SCALE * (1 - easeInOut(sink) * 0.75), mood: 'sly', alpha: 1 - sink * 0.6, shadow: false, wings: member.role === 'nibbler' }),
      });
    }
    for (const { member, ghost } of dreamers) {
      const at = px(ghost);
      const alpha = dreamAlpha(member.name);
      if (alpha <= 0.01 || !inView(at.x, at.y, tile * 2)) continue;
      const spot = ghost.moving ? null : this.spotAt(ghost.x, ghost.y);
      const facing = spot ? spot.face : ghost.dx < -0.001 ? -1 : 1;
      drawables.push({
        base: at.y,
        draw: () => drawActor(ctx, { ...this.look(member, time), pace, x: at.x, y: at.y, scale: ACTOR_SCALE, facing, walking: ghost.moving, working: spot !== null, dream: true, alpha, mood: 'happy' }),
      });
    }
    drawables.sort((a, b) => a.base - b.base);
    for (const item of drawables) item.draw();

    // 妖精の手から飛ぶ、ずんだ色のきらめきと、餅に変わる「もちっ」。見ていた人の「！」
    if (nap && napEvent && napK >= -0.12 && napK <= 1) {
      const giver = poses[this.byName.get(napEvent.by)?.seat ?? -1];
      const target = poses[this.byName.get(napEvent.target)?.seat ?? -1];
      if (target) {
        const to = px(target);
        const fly = clamp01((napK + 0.125) / 0.135);
        if (fly < 1) {
          // 役職を隠している時は、誰の手から出たかを見せない（上から降ってくる）
          const from = options.secrets && giver ? { x: px(giver).x, y: px(giver).y - tile * 0.7 } : { x: to.x, y: to.y - tile * 2.4 };
          for (let i = 0; i < 7; i++) {
            const k = clamp01(easeOut(fly) - i * 0.06);
            if (k <= 0) continue;
            const sx = lerp(from.x, to.x, k) + Math.sin(i * 2.3 + time * 9) * tile * 0.12;
            const sy = lerp(from.y, to.y - tile * 0.5, k) - Math.sin(k * Math.PI) * tile * 0.6;
            sparkle(ctx, sx, sy, tile * (0.1 - i * 0.008), `rgba(${i % 2 === 0 ? '156, 204, 82' : '232, 248, 200'}, ${0.95 - i * 0.1})`);
          }
        } else {
          // ぱっと散る、きらめきと湯気
          const burst = clamp01(napK / 0.45);
          if (burst < 1) {
            for (let i = 0; i < 10; i++) {
              const angle = (i / 10) * Math.PI * 2 + rand(i + 3) * 0.4;
              const dist = tile * (0.35 + easeOut(burst) * (0.75 + rand(i) * 0.5));
              sparkle(ctx, to.x + Math.cos(angle) * dist, to.y - tile * 0.45 + Math.sin(angle) * dist * 0.7, tile * 0.09 * (1 - burst * 0.6), `rgba(${i % 3 === 0 ? '255, 255, 255' : '156, 204, 82'}, ${1 - burst})`);
            }
          }
          if (napK < 0.8) drawText(ctx, 'もちっ！', to.x, to.y - tile * (1.35 + napK * 0.45), { size: tile * 0.46, color: ZUNDA_DARK, stroke: '#fff', strokeWidth: tile * 0.12, align: 'center', alpha: hill(napK / 0.8, 0.25), weight: 900 });
        }
      }
    }

    // 占い: 占い師の玉から、占われた人へ、むらさきの光が飛ぶ。届いたら、結果の札（役職を見せている時だけ）。
    // 占われた狐は、その場で餅になる（「もちっ」は、役職を隠している時も出す。誰が占ったかは見せない）
    // 結果の札は、名札・仕込みの札・ふきだしに隠れないよう、それらのあとで描く
    let divineTag: ((y: number) => void) | null = null;
    let divineTagAt = { x: 0, y: 0 };
    if (divineEvent && divineK >= -0.25 && divineK <= 1.3 + divineHold) {
      const giver = poses[this.byName.get(divineEvent.by)?.seat ?? -1];
      const target = poses[this.byName.get(divineEvent.target)?.seat ?? -1];
      if (target) {
        const to = px(target);
        const fly = clamp01((divineK + 0.25) / 0.25);
        if (fly < 1) {
          if (options.secrets && giver) {
            const from = { x: px(giver).x, y: px(giver).y - tile * 1.2 };
            for (let i = 0; i < 7; i++) {
              const k = clamp01(easeOut(fly) - i * 0.06);
              if (k <= 0) continue;
              const sx = lerp(from.x, to.x, k) + Math.sin(i * 2.3 + time * 9) * tile * 0.1;
              const sy = lerp(from.y, to.y - tile * 0.6, k) - Math.sin(k * Math.PI) * tile * 0.5;
              sparkle(ctx, sx, sy, tile * (0.1 - i * 0.008), `rgba(${i % 2 === 0 ? '151, 117, 250' : '229, 219, 255'}, ${0.95 - i * 0.1})`);
            }
          }
        } else if (options.secrets || divineEvent.cursed) {
          const burst = clamp01(divineK / 0.45);
          if (burst < 1) {
            for (let i = 0; i < 10; i++) {
              const angle = (i / 10) * Math.PI * 2 + rand(i + 3) * 0.4;
              const dist = tile * (0.35 + easeOut(burst) * (0.75 + rand(i) * 0.5));
              const tone = divineEvent.cursed && i % 2 === 0 ? '156, 204, 82' : options.secrets ? '151, 117, 250' : '156, 204, 82';
              sparkle(ctx, to.x + Math.cos(angle) * dist, to.y - tile * 0.45 + Math.sin(angle) * dist * 0.7, tile * 0.09 * (1 - burst * 0.6), `rgba(${i % 3 === 0 ? '255, 255, 255' : tone}, ${1 - burst})`);
            }
          }
          if (divineEvent.cursed && divineK < 0.8) drawText(ctx, 'もちっ！', to.x, to.y - tile * (1.35 + divineK * 0.45), { size: tile * 0.46, color: ZUNDA_DARK, stroke: '#fff', strokeWidth: tile * 0.12, align: 'center', alpha: hill(divineK / 0.8, 0.25), weight: 900 });
          if (options.secrets) {
            // 結果の札（占い師にだけ分かったこと）。狐は「狐だった！」
            const text = divineEvent.cursed ? '狐だった！' : divineEvent.fairy ? '妖精だった！' : '妖精ではない';
            const fill = divineEvent.cursed ? ROLE_COLOR.fox : divineEvent.fairy ? ROLE_COLOR.nibbler : ROLE_COLOR.artisan;
            const show = clamp01((divineK - (divineEvent.cursed ? 0.5 : 0.05)) / 0.12) * clamp01((1.3 + divineHold - divineK) / 0.15);
            if (show > 0) divineTag = (y: number) => drawTag(ctx, to.x, y, text, fill, { size: Math.max(tile * 0.4, 30 / k), alpha: show });
            divineTagAt = { x: to.x, y: to.y - tile * 2.05 };
          }
        }
      }
    }

    // 妖精が狐に手をかざしたが、餅にならなかった（役職を見せている時だけ）。ずんだ色の光が、狐に当たってはね返り、「効かない！」
    if (options.secrets) {
      for (const cue of this.misses) {
        const mk = (poseTime - cue.at) / Math.max(0.5, cue.end - cue.at);
        if (mk < 0 || mk > 1 || !inSegment(cue)) continue;
        const target = poses[this.byName.get((cue.event as EventOf<'nap_failed'>).target)?.seat ?? -1];
        if (!target) continue;
        const to = px(target);
        const burst = clamp01(mk / 0.45);
        if (burst < 1) {
          for (let i = 0; i < 10; i++) {
            const angle = (i / 10) * Math.PI * 2 + rand(i + 7) * 0.4;
            const dist = tile * (0.35 + easeOut(burst) * (0.8 + rand(i + 1) * 0.5));
            sparkle(ctx, to.x + Math.cos(angle) * dist, to.y - tile * 0.45 + Math.sin(angle) * dist * 0.7, tile * 0.09 * (1 - burst * 0.6), `rgba(${i % 2 === 0 ? '156, 204, 82' : '255, 170, 80'}, ${1 - burst})`);
          }
        }
        drawText(ctx, '効かない！', to.x, to.y - tile * (1.35 + mk * 0.3), { size: tile * 0.46, color: ROLE_COLOR.fox, stroke: '#fff', strokeWidth: tile * 0.12, align: 'center', alpha: hill(mk, 0.15) });
      }
    }

    // 名札（重なったら下へずらす）。心だけの人の名札は、うすい色。
    // あかりが消えている間は、暗がりに沈まないよう、暗がりのあとで描く
    const order = [...actors.map((a) => ({ member: a.member, at: px(a.pose), ghostly: false, dream: 0 })), ...dreamers.map((d) => ({ member: d.member, at: px(d.ghost), ghostly: true, dream: dreamAlpha(d.member.name) }))].sort((a, b) => a.at.y - b.at.y);
    const drawNameTags = () => {
      const labels: { x: number; y: number; w: number }[] = [];
      for (const { member, at, ghostly, dream } of order) {
        // 心だけの姿がまだ現れていない間は、名札も出さない（餅になった体の名札と二重になる）
        if (ghostly && dream <= 0) continue;
        if (!inView(at.x, at.y, tile * 3)) continue;
        const size = tile * (ghostly ? 0.28 : 0.34);
        const text = ghostly ? `${member.name}（心だけ）` : member.name;
        setFont(ctx, size, 700);
        const width = ctx.measureText(text).width + size * 0.9;
        // 名札の下に、頭脳の札（どの AI か）
        const chipSize = size * 0.62;
        const step = size + chipSize * 1.5 + 6;
        let ly = at.y + tile * 0.28;
        for (let tries = 0; tries < 4; tries++) {
          const hit = labels.find((l) => Math.abs(l.y - ly) < step && Math.abs(l.x - at.x) < (l.w + width) / 2);
          if (!hit) break;
          ly = hit.y + step;
        }
        labels.push({ x: at.x, y: ly, w: width });
        const tag = options.secrets ? ROLE_TAG[member.role] : null;
        ctx.save();
        if (ghostly) ctx.globalAlpha *= dream * 0.9;
        roundRect(ctx, at.x - width / 2, ly - size * 0.62, width, size * 1.24, size * 0.62);
        ctx.fillStyle = ghostly ? 'rgba(86, 98, 178, 0.8)' : (tag ?? 'rgba(50, 32, 18, 0.78)');
        ctx.fill();
        drawText(ctx, text, at.x, ly + 1, { size, color: '#fff', align: 'center', weight: 700 });
        if (!ghostly) drawBrainChip(ctx, at.x, ly + size * 0.62 + chipSize * 0.85, member.brainId, chipSize, { short: true, align: 'center' });
        ctx.beginPath();
        ctx.arc(at.x - width / 2 - 1, ly, size * 0.34, 0, Math.PI * 2);
        ctx.fillStyle = ghostly ? member.color.light : member.color.main;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#fff';
        ctx.stroke();
        ctx.restore();
      }
    };
    const dark = now.dark > 0.01;
    if (!dark) drawNameTags();
    drawAtmosphere(ctx, shop, time, daylight, view);

    // かまどの焚きすぎ: 直す場所が、赤く明滅する
    if (trouble?.what === 'crisis') {
      const urgency = 1 - (trouble.left ?? 0) / Math.max(1, trouble.seconds ?? 1);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (const [index, spot] of fixSpots.entries()) {
        const cx = spot.x * tile;
        const cy = spot.y * tile;
        const radius = tile * (index === 0 ? 4.2 : 2.4) * (0.9 + Math.sin(time * 9 + index) * 0.08);
        if (!inView(cx, cy, radius)) continue;
        const glow = ctx.createRadialGradient(cx, cy, 2, cx, cy, radius);
        glow.addColorStop(0, `rgba(255, 96, 40, ${(0.3 + urgency * 0.3) * (0.6 + 0.4 * Math.sin(time * (5 + urgency * 8)))})`);
        glow.addColorStop(1, 'rgba(255, 96, 40, 0)');
        ctx.fillStyle = glow;
        ctx.fillRect(cx - radius, cy - radius, radius * 2, radius * 2);
      }
      ctx.restore();
      // 立ちのぼる、こげた煙（かまどの火のほう）
      const stove = fixSpots[0];
      if (stove && inView(stove.x * tile, stove.y * tile, tile * 4)) {
        for (let i = 0; i < 7; i++) {
          const r = (time * 0.45 + i / 7) % 1;
          ctx.beginPath();
          ctx.arc(stove.x * tile + Math.sin(r * 6 + i * 2.1) * tile * 0.35, (stove.y - 0.9) * tile - r * tile * 1.9, tile * (0.14 + r * 0.3), 0, Math.PI * 2);
          ctx.fillStyle = `rgba(70, 56, 52, ${0.5 * Math.sin(r * Math.PI)})`;
          ctx.fill();
        }
      }
    }
    ctx.restore();

    // あかりが消えた時の暗がり。人のまわりだけ、手もとの明かりで見える
    if (now.dark > 0.01) this.drawDarkness(ctx, now, poses, fixSpots, camera.zoom, ox, oy, time);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(k, k);
    // 追っている人に見えている範囲の外を、少し暗くする（壁の向こうや遠く、閉まった戸の向こうは、その人には見えていない）
    const watcher = camera.subject !== null ? poses[camera.subject] : undefined;
    if (isUp(watcher) && camera.shade > 0.01) {
      // あかりが消えると、従業員の見える距離は短くなる。役職を隠している時は、誰でも同じに見せる
      const sharp = options.secrets && this.members[camera.subject ?? -1]?.role === 'nibbler';
      const radius = vision * (sharp ? 1 : lerp(1, dim, now.dark));
      const blocked = closed.size > 0 ? { ...shop, wall: (tx: number, ty: number) => shop.wall(tx, ty) || closed.has(ty * shop.cols + tx) } : shop;
      const sight = sightPolygon(blocked, watcher.x, watcher.y, radius);
      const trace = () => {
        ctx.moveTo((sight[0] as number) * tile, (sight[1] as number) * tile);
        for (let i = 2; i < sight.length; i += 2) ctx.lineTo((sight[i] as number) * tile, (sight[i + 1] as number) * tile);
        ctx.closePath();
      };
      ctx.save();
      ctx.beginPath();
      ctx.rect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
      trace();
      ctx.fillStyle = `rgba(14, 12, 30, ${0.5 * camera.shade})`;
      ctx.fill('evenodd');
      ctx.restore();
    }
    if (dark) drawNameTags();

    // 直す場所の目印（まだ誰も押さえていない所に、はねる矢印と名前）
    for (const spot of fixSpots) {
      const cx = spot.x * tile;
      const cy = spot.y * tile;
      if (!inView(cx, cy, tile * 3) || heldAt(spot)) continue;
      const tone = trouble?.what === 'crisis' ? '#d63a2f' : '#e6a21f';
      const ay = cy - tile * 1.25 - Math.abs(Math.sin(time * 4.2)) * tile * 0.2;
      const size = tile * 0.3;
      setFont(ctx, size, 800);
      const w = ctx.measureText(spot.name).width + size * 1.2;
      roundRect(ctx, cx - w / 2, ay - size * 1.75, w, size * 1.5, size * 0.75);
      ctx.fillStyle = tone;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      drawText(ctx, spot.name, cx, ay - size, { size, color: '#fff', align: 'center', weight: 800 });
      ctx.beginPath();
      ctx.moveTo(cx, ay + tile * 0.3);
      ctx.lineTo(cx - tile * 0.2, ay);
      ctx.lineTo(cx + tile * 0.2, ay);
      ctx.closePath();
      ctx.fillStyle = tone;
      ctx.fill();
      ctx.stroke();
    }

    // 床下を進んでいる人（役職を見せている時だけ）: 入口から出口への点線と、進んでいる位置
    for (const span of sneaks) {
      const member = this.members[span.seat];
      const pose = poses[span.seat];
      if (!member || !pose || pose.state !== 'u' || poseTime < span.start + 0.3) continue;
      const to = span.to ?? span.from;
      ctx.save();
      ctx.setLineDash([tile * 0.2, tile * 0.16]);
      ctx.lineDashOffset = -time * tile * 0.9;
      ctx.lineWidth = tile * 0.08;
      ctx.strokeStyle = 'rgba(214, 58, 47, 0.85)';
      ctx.beginPath();
      ctx.moveTo(span.from.x * tile, span.from.y * tile);
      ctx.lineTo(to.x * tile, to.y * tile);
      ctx.stroke();
      ctx.restore();
      const mx = pose.x * tile;
      const my = pose.y * tile;
      ctx.beginPath();
      ctx.arc(mx, my, tile * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(46, 18, 14, 0.88)';
      ctx.fill();
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = member.color.main;
      ctx.stroke();
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.ellipse(mx + side * tile * 0.1, my - tile * 0.02, tile * 0.05, tile * 0.07, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#fff';
        ctx.fill();
      }
      drawText(ctx, `${member.name}（床下）`, mx, my + tile * 0.56, { size: tile * 0.28, color: '#fff', stroke: 'rgba(120, 24, 18, 0.95)', strokeWidth: tile * 0.09, align: 'center', weight: 800 });
    }
    // 抜け道の出入りを見ていた人の「！」
    if (options.secrets) {
      for (const span of sneaks) {
        for (const [at, names] of [[span.start, span.seenIn], [span.end, span.seenOut]] as const) {
          const life = (poseTime - at) / 1.2;
          if (life < 0 || life > 1) continue;
          for (const name of names) {
            const witness = this.byName.get(name);
            const pose = poses[witness?.seat ?? -1];
            if (!isUp(pose) || witness?.role === 'nibbler') continue;
            const where = px(pose);
            drawText(ctx, '！', where.x + tile * 0.1, where.y - tile * 1.5, { size: tile * 0.7 * easeBack(life / 0.2), color: '#d63a2f', stroke: '#fff', align: 'center', weight: 900, alpha: hill(life, 0.2) });
          }
        }
      }
    }

    // 閉まった戸の、開くまでの秒
    const doorSeconds = config?.doorSeconds;
    if (doorSeconds !== undefined) {
      for (const span of now.shut) {
        const left = Math.ceil(Math.max(0, doorSeconds - (poseTime - span.start)));
        for (const door of this.doorRects[span.room] ?? []) {
          const cx = (door.x + door.w / 2) * tile;
          const cy = (door.y + door.h / 2) * tile - tile * 0.55;
          if (!inView(cx, cy, tile)) continue;
          ctx.beginPath();
          ctx.arc(cx, cy, tile * 0.3, 0, Math.PI * 2);
          ctx.fillStyle = '#a3261d';
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
          drawText(ctx, String(left), cx, cy + 1, { size: tile * 0.34, color: '#fff', align: 'center', weight: 900 });
        }
      }
    }

    // 持ち場で手を動かしている人: していることと、進み具合（札どうしが重なる時は、上へ積む）
    const raised: { x: number; y: number }[] = [];
    const clear = (x: number, y: number) => {
      let top = y;
      for (let tries = 0; tries < 5; tries++) {
        if (!raised.some((r) => Math.abs(r.x - x) < tile * 1.7 && Math.abs(r.y - top) < tile * 0.66)) break;
        top -= tile * 0.7;
      }
      raised.push({ x, y: top });
      return top;
    };
    for (const { member, pose } of actors) {
      if (pose.state !== 'w') continue;
      const at = px(pose);
      if (!inView(at.x, at.y, tile * 2)) continue;
      const spot = this.spotAt(pose.x, pose.y);
      const span = this.workAt(segment, member.seat, poseTime);
      const ratio = span ? (poseTime - span.start) / Math.max(0.2, span.end - span.start) : 0;
      const fake = options.secrets && this.fakeWork(member.role) && spot?.kind === 'station';
      if (!spot) continue;
      const top = clear(at.x, at.y - tile * 1.55);
      if (spot.kind === 'crisis') this.workLabel(ctx, at.x, top, tile, `${spot.name}を押さえている`, null, 'fix', time);
      else if (spot.kind === 'lights') this.workLabel(ctx, at.x, top, tile, 'ブレーカーを上げている', ratio, 'fix', time);
      else this.workLabel(ctx, at.x, top, tile, fake ? `${spot.name}（ふり）` : spot.name, ratio, fake ? 'fake' : 'task', time);
    }
    // 工房の道具を見ている人: 見ている道具と、見終わるまで
    for (const span of this.show.looks) {
      if (poseTime < span.start || poseTime >= span.end) continue;
      const pose = poses[span.seat];
      if (!isUp(pose)) continue;
      const at = px(pose);
      if (!inView(at.x, at.y, tile * 2)) continue;
      const device = this.show.log.roam?.map.devices?.[span.device];
      const ratio = Number.isFinite(span.end) ? (poseTime - span.start) / Math.max(0.2, span.end - span.start) : null;
      this.workLabel(ctx, at.x, clear(at.x, at.y - tile * 1.55), tile, `${device?.name ?? '道具'}を見ている`, ratio, 'look', time);
    }

    // 仕込みが1つ終わった合図（心だけの人は、心だけの姿の上に出る）
    for (const cue of this.tasks) {
      if (poseTime < cue.at || poseTime > cue.end || !inSegment(cue)) continue;
      const event = cue.event as EventOf<'task'>;
      const seat = this.byName.get(event.agent)?.seat ?? -1;
      const where = event.spirit ? now.ghosts[seat] : poses[seat];
      if (!where || (!event.spirit && !isUp(poses[seat]))) continue;
      const at = px(where);
      if (!inView(at.x, at.y, tile * 2)) continue;
      const life = (poseTime - cue.at) / (cue.end - cue.at);
      const y = at.y - tile * (1.7 + easeOut(life) * 0.55);
      const alpha = hill(life, 0.18);
      const size = tile * 0.3;
      if (event.pretend && options.secrets) {
        drawText(ctx, 'ふりだけ…', at.x, y, { size, color: '#b3271e', stroke: '#fff', strokeWidth: size * 0.3, align: 'center', weight: 800, alpha });
        continue;
      }
      setFont(ctx, size, 800);
      const half = ctx.measureText(event.what).width / 2;
      ctx.save();
      ctx.globalAlpha *= alpha;
      zundaMochi(ctx, at.x - half - size * 0.2, y, size * 0.52 * easeBack(life / 0.2));
      ctx.restore();
      drawText(ctx, event.what, at.x + size * 0.5, y, { size, color: event.spirit ? '#4f5db3' : '#3f7d1f', stroke: '#fff', strokeWidth: size * 0.3, align: 'center', weight: 800, alpha });
    }

    // ふきだし（声に出したこと・いま決めたこと）。明かりや暗さの上に描いて、読みやすくする
    for (const { member, pose } of actors) {
      const chat = isUp(pose) ? this.activeChat(member.name, poseTime, segment) : null;
      if (chat) {
        const at = px(pose);
        const life = (poseTime - chat.at) / (chat.end - chat.at);
        this.speechBalloon(ctx, at.x, clear(at.x, at.y - tile * 1.5), displayText((chat.event as EventOf<'chat'>).say), member, { size: tile * 0.3, alpha: hill(life, 0.08), pop: easeBack(life / 0.1) });
        continue;
      }
      const cue = this.activeDecide(member.name, poseTime, segment);
      if (!cue || pose.state !== 'a') continue;
      if (napEvent && napK >= -0.12 && napEvent.by === member.name) continue; // 渡している最中は出さない
      // 占いの結果の札が出ている間は、占った人と占われた人のふきだしを出さない（札が隠れる）
      if (divineEvent && options.secrets && divineK >= -0.05 && divineK <= 1.3 + divineHold && (divineEvent.by === member.name || divineEvent.target === member.name)) continue;
      const event = cue.event as EventOf<'decide'>;
      const secret = SECRET_ACTIONS.has(event.action);
      if (!event.applied || (secret && !options.secrets)) continue;
      const at = px(pose);
      const life = (poseTime - cue.at) / (cue.end - cue.at);
      const text = this.actionText(event, false, options.secrets);
      // 占い師の「占う」は、むらさき（妖精のたくらみの赤と分ける）
      const seeing = event.action === 'divine';
      const sly = !seeing && (secret || (options.secrets && this.fakeWork(member.role) && event.action === 'do_task'));
      this.bubble(ctx, at.x, clear(at.x, at.y - tile * 1.5), text, { size: tile * 0.32, alpha: hill(life, 0.12), pop: easeBack(life / 0.12), fill: seeing ? '#efe7ff' : sly ? '#ffe3df' : '#fff', color: seeing ? '#5f3dc4' : sly ? '#b3271e' : INK });
    }

    // 占いの結果の札。仕込みの札と重なる時は、その上へ積む
    divineTag?.(clear(divineTagAt.x, divineTagAt.y));

    // 餅に変わった瞬間、まわりの人に札: 見た！ / 仲間なので知らんぷり / 暗くて・壁で・遠くて見えない（役職を見せている時だけ）
    // ふきだしの上に重ねて描き、右の列にかからないよう、左へ寄せる
    const tagged = options.secrets ? this.naps.find((cue) => inSegment(cue) && poseTime >= cue.at + 0.1 && poseTime <= cue.at + SIGHT_TAG_SECONDS) : undefined;
    if (tagged) {
      const since = poseTime - tagged.at - 0.1;
      const fade = clamp01((SIGHT_TAG_SECONDS - 0.1 - since) / 0.35);
      const size = Math.max(tile * 0.36, 30 / k);
      const right = (RIGHT_X - 40 - ox) / k;
      for (const [n, { seat, kind }] of this.bystanders(tagged, segment, shop, vision, dim).entries()) {
        const pose = poses[seat];
        if (!isUp(pose)) continue;
        const at = px(pose);
        if (!inView(at.x, at.y, tile)) continue;
        const pop = easeBack((since - n * 0.08) / 0.3);
        if (pop <= 0) continue;
        const tag = SIGHT_TAG[kind];
        setFont(ctx, size, 900);
        const half = (ctx.measureText(tag.text).width + size * 1.2) / 2;
        const x = Math.max(view.x0 + half + 8 / k, Math.min(at.x, right - half));
        const y = clear(at.x, at.y - tile * 1.5) - size * 0.2;
        ctx.save();
        ctx.translate(x, y);
        ctx.scale(pop, pop);
        drawTag(ctx, 0, 0, tag.text, tag.fill, { size, alpha: fade });
        ctx.restore();
      }
    }
    ctx.restore();

    // かまどの焚きすぎ: 画面のふちが、赤く脈うつ（残りが少ないほど速く、濃く）
    if (trouble?.what === 'crisis') {
      const urgency = 1 - (trouble.left ?? 0) / Math.max(1, trouble.seconds ?? 1);
      const beat = 0.5 + 0.5 * Math.sin(time * (3.5 + urgency * 7));
      const edge = ctx.createRadialGradient(ANCHOR_X, ANCHOR_Y, 320, ANCHOR_X, ANCHOR_Y, 1180);
      edge.addColorStop(0, 'rgba(210, 36, 22, 0)');
      edge.addColorStop(1, `rgba(210, 36, 22, ${(0.2 + urgency * 0.3) * (0.45 + 0.55 * beat) * clamp01(trouble.age / 0.4)})`);
      ctx.fillStyle = edge;
      ctx.fillRect(0, 0, W, H);
    }

    // 離れた場所へ切り替わった時は、一瞬だけ暗くしてつなぐ
    if (camera.sinceCut < 0.28) {
      ctx.save();
      ctx.globalAlpha = (1 - camera.sinceCut / 0.28) * 0.7;
      ctx.fillStyle = '#1d140c';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }
    // 札や名簿の下になる右と下の端は、少し暗くして読みやすくする
    const edge = ctx.createLinearGradient(RIGHT_X - 60, 0, W, 0);
    edge.addColorStop(0, 'rgba(24, 16, 10, 0)');
    edge.addColorStop(0.3, 'rgba(24, 16, 10, 0.5)');
    edge.addColorStop(1, 'rgba(24, 16, 10, 0.66)');
    ctx.fillStyle = edge;
    ctx.fillRect(RIGHT_X - 60, 0, W - RIGHT_X + 60, H);
  }

  /**
   * あかりが消えた時の暗がり（画面の座標で描く）。部屋はまっ暗にして、人のまわりだけを小さく照らす。
   * 停電が起きたことが、ひと目で分かるように、照らす丸は役職によらず同じ大きさにする（妖精が暗くても見えることは、説明の絵と札で伝える）。
   */
  private drawDarkness(ctx: Ctx, now: WorldNow, poses: ActorPose[], fixSpots: Spot[], zoom: number, ox: number, oy: number, time: number): void {
    const fine = 0.5;
    if (!this.darkLayer) {
      this.darkLayer = document.createElement('canvas');
      this.darkLayer.width = W * fine;
      this.darkLayer.height = H * fine;
    }
    const d = this.darkLayer.getContext('2d') as CanvasRenderingContext2D;
    d.setTransform(fine, 0, 0, fine, 0, 0);
    d.globalCompositeOperation = 'source-over';
    d.clearRect(0, 0, W, H);
    d.fillStyle = `rgba(5, 6, 20, ${0.94 * now.dark})`;
    d.fillRect(0, 0, W, H);
    d.globalCompositeOperation = 'destination-out';
    // 真ん中から core までは、はっきり明るく、そこから外へ、ぼかして暗がりへつなぐ
    const hole = (x: number, y: number, r: number, strength: number, core = 0.45) => {
      if (x < -r || x > W + r || y < -r || y > H + r) return;
      const g = d.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(0, 0, 0, ${strength})`);
      g.addColorStop(core, `rgba(0, 0, 0, ${strength})`);
      g.addColorStop(1, 'rgba(0, 0, 0, 0)');
      d.fillStyle = g;
      d.fillRect(x - r, y - r, r * 2, r * 2);
    };
    for (const member of this.members) {
      const pose = poses[member.seat];
      if (!pose || pose.state === 'x' || pose.state === 'u') continue;
      const x = ox + pose.x * zoom;
      const y = oy + pose.y * zoom - zoom * 0.35;
      if (pose.state === 'z') {
        hole(x, y, zoom * 0.95, 0.55, 0.3);
        continue;
      }
      // 手もとの明かり。ほんの少しゆらぐ
      hole(x, y, zoom * 1.65 * (1 + Math.sin(time * 6 + member.seat) * 0.03), 1);
    }
    for (const ghost of now.ghosts) if (ghost) hole(ox + ghost.x * zoom, oy + ghost.y * zoom - zoom * 0.35, zoom * 1.05, 0.55, 0.3);
    // 直す場所は、目当てが分かるよう、ぼんやり光らせる
    for (const spot of fixSpots) hole(ox + spot.x * zoom, oy + spot.y * zoom, zoom * (1.3 + Math.sin(time * 4) * 0.12), 0.7, 0.2);
    ctx.drawImage(this.darkLayer, 0, 0, W, H);
  }

  /**
   * 工房の道具を見ている人をカメラが映している間、その人に見えているものを、画面の左上に出す。
   * 見取り図の盤は部屋ごとの人数、名札かけは全員の名札、防犯カメラの画面は廊下の4つの映像。
   */
  private drawLookPanel(ctx: Ctx, segment: RoamSegment, poses: ActorPose[], camera: Camera, poseTime: number, time: number): void {
    const shop = this.shop;
    const devices = this.show.log.roam?.map.devices;
    if (!shop || !devices || camera.subject === null) return;
    const span = this.show.looks.find((s) => s.seat === camera.subject && poseTime >= s.start && poseTime < s.end + 0.35 && s.start >= segment.start - 0.01);
    const device = span ? devices[span.device] : undefined;
    const member = span ? this.members[span.seat] : undefined;
    if (!span || !device || !member) return;
    const enter = easeOut((poseTime - span.start) / 0.3);
    const leave = Number.isFinite(span.end) ? clamp01((span.end + 0.35 - poseTime) / 0.35) : 1;
    const x = 28;
    const y = 104;
    // 幅は、真ん中に映る本人の頭の上の札にかからない所まで
    const w = 548;
    const h = span.device === 'cameras' ? 470 : span.device === 'vitals' ? 420 : 410;
    ctx.save();
    ctx.globalAlpha = Math.min(enter, leave);
    ctx.translate((1 - enter) * -40, 0);
    plaque(ctx, x, y, w, h, { radius: 22, fill: span.device === 'cameras' ? '#232a30' : PAPER, edge: span.device === 'cameras' ? '#14191b' : WOOD_DARK });
    // 見出し: 誰が、どの道具を見ているか
    setFont(ctx, 24, 800);
    const nw = ctx.measureText(member.name).width + 32;
    roundRect(ctx, x + 18, y + 14, nw, 40, 20);
    ctx.fillStyle = member.color.main;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = member.color.dark;
    ctx.stroke();
    drawText(ctx, member.name, x + 18 + nw / 2, y + 35, { size: 24, color: '#fff', align: 'center', weight: 800, stroke: member.color.dark, strokeWidth: 4 });
    drawText(ctx, `が見ている　${device.room}の「${device.name}」`, x + 18 + nw + 12, y + 35, { size: 24, weight: 800, color: span.device === 'cameras' ? '#e8f3ee' : INK });
    const body = { x: x + 18, y: y + 66, w: w - 36, h: h - 84 };
    if (span.device === 'admin') this.drawAdminBody(ctx, shop, body, span.counts ?? null);
    else if (span.device === 'vitals') this.drawVitalsBody(ctx, body, span.tags ?? null, poseTime, time);
    else this.drawCameraFeeds(ctx, shop, segment, body, poses, span.seat, poseTime, time);
    ctx.restore();
  }

  /** 見取り図の盤: 工房の見取り図に、部屋ごとの人数。廊下は出ない。誰なのかも出ない。 */
  private drawAdminBody(ctx: Ctx, shop: Workshop, body: { x: number; y: number; w: number; h: number }, counts: Record<string, number> | null): void {
    const scale = Math.min(body.w / shop.mini.width, (body.h - 30) / shop.mini.height);
    const mw = shop.mini.width * scale;
    const mh = shop.mini.height * scale;
    const mx = body.x + (body.w - mw) / 2;
    const my = body.y;
    ctx.drawImage(shop.mini, mx, my, mw, mh);
    const per = (scale * shop.miniTile);
    for (const room of shop.rooms) {
      const cx = mx + (room.x + room.w / 2) * per;
      const cy = my + (room.y + room.h / 2) * per;
      const n = counts?.[room.name] ?? 0;
      drawText(ctx, room.name, cx, cy - (n > 0 ? 17 : 0), { size: 15, align: 'center', weight: 800, color: 'rgba(59, 42, 30, 0.75)' });
      if (n <= 0) continue;
      ctx.beginPath();
      ctx.arc(cx, cy + 9, 15, 0, Math.PI * 2);
      ctx.fillStyle = n === 1 ? '#c0392b' : ZUNDA_DARK;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
      drawText(ctx, String(n), cx, cy + 10, { size: 19, align: 'center', weight: 900, color: '#fff' });
    }
    drawText(ctx, '数字は、その部屋にいる人数（廊下の人は出ない・誰なのかは出ない）', body.x + body.w / 2, my + mh + 18, { size: 17, align: 'center', weight: 700, color: '#6b5a48' });
  }

  /** 名札かけ: 全員の名札。ずんだ餅になった人と、クビになった人が分かる。 */
  private drawVitalsBody(ctx: Ctx, body: { x: number; y: number; w: number; h: number }, tags: { name: string; status: 'awake' | 'asleep' | 'sent_home' }[] | null, poseTime: number, time: number): void {
    const status = this.statusAt(poseTime);
    const list = tags ?? this.members.map((m) => ({ name: m.name, status: status.get(m.name) === 'z' ? ('asleep' as const) : status.get(m.name) === 'x' ? ('sent_home' as const) : ('awake' as const) }));
    const cols = 3;
    const cw = body.w / cols;
    const ch = Math.min(84, body.h / Math.ceil(list.length / cols));
    list.forEach((tag, i) => {
      const member = this.byName.get(tag.name);
      if (!member) return;
      const cx = body.x + (i % cols) * cw;
      const cy = body.y + Math.floor(i / cols) * ch;
      const asleep = tag.status === 'asleep';
      const gone = tag.status === 'sent_home';
      roundRect(ctx, cx + 4, cy + 4, cw - 8, ch - 8, 14);
      ctx.fillStyle = asleep ? '#e3f1cf' : gone ? '#dcd6cc' : '#fffdf6';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = asleep ? ZUNDA_DARK : gone ? '#8c8478' : member.color.dark;
      ctx.stroke();
      if (asleep) zundaMochi(ctx, cx + 38, cy + ch / 2 + 4, 26, true);
      else drawPortrait(ctx, cx + 38, cy + ch / 2, 26, { ...this.look(member, time), mood: 'normal', dim: gone });
      drawText(ctx, member.name, cx + 74, cy + ch / 2 - 12, { size: 21, weight: 800, color: gone ? '#7a7166' : INK });
      const label = asleep ? 'ずんだ餅' : gone ? 'クビ' : '起きている';
      drawText(ctx, label, cx + 74, cy + ch / 2 + 15, { size: 17, weight: 800, color: asleep ? ZUNDA_DARK : gone ? '#7a7166' : '#4a7fb0' });
    });
  }

  /** 防犯カメラごとの、映る範囲の升目の四角（壁の向こうと、映る距離の外を除く）。 */
  private cameraBoxes(): { x0: number; y0: number; x1: number; y1: number; vertical: boolean }[] {
    if (this.camBoxes) return this.camBoxes;
    const cameras = this.show.log.roam?.map.devices?.cameras;
    const grid = this.grid;
    this.camBoxes = (cameras?.points ?? []).map((point) => {
      const eye = centerOf(point);
      const box = { x0: point.x, y0: point.y, x1: point.x + 1, y1: point.y + 1 };
      const r = Math.ceil(cameras?.radius ?? 0);
      for (let y = point.y - r; y <= point.y + r; y++) {
        for (let x = point.x - r; x <= point.x + r; x++) {
          const at = centerOf({ x, y });
          if (!grid || x < 0 || y < 0 || x >= grid.width || y >= grid.height) continue;
          if (Math.hypot(at.x - eye.x, at.y - eye.y) > (cameras?.radius ?? 0) || !hasLineOfSight(grid, eye, at)) continue;
          box.x0 = Math.min(box.x0, x);
          box.y0 = Math.min(box.y0, y);
          box.x1 = Math.max(box.x1, x + 1);
          box.y1 = Math.max(box.y1, y + 1);
        }
      }
      return { ...box, vertical: box.y1 - box.y0 > box.x1 - box.x0 };
    });
    return this.camBoxes;
  }

  /**
   * 防犯カメラの画面: 廊下のカメラの映像。横の廊下は横長、縦の廊下は縦長の映像にする。
   * 映るのは、カメラから見通せて、映る距離の中の人だけ（壁の向こうは映らない）。暗くても映る。
   */
  private drawCameraFeeds(ctx: Ctx, shop: Workshop, segment: RoamSegment, body: { x: number; y: number; w: number; h: number }, poses: ActorPose[], watcher: number, poseTime: number, time: number): void {
    const cameras = this.show.log.roam?.map.devices?.cameras;
    if (!cameras) return;
    const tile = shop.tile;
    const pace = roamClockAt(segment, poseTime);
    const boxes = this.cameraBoxes();
    const gap = 10;
    const tall = cameras.points.map((_, i) => i).filter((i) => boxes[i]?.vertical);
    const wide = cameras.points.map((_, i) => i).filter((i) => !boxes[i]?.vertical);
    const tallW = wide.length > 0 ? 96 : (body.w - gap * (tall.length - 1)) / Math.max(1, tall.length);
    const wideW = body.w - tall.length * (tallW + gap);
    const frames = new Map<number, { x: number; y: number; w: number; h: number }>();
    wide.forEach((i, n) => {
      const h = (body.h - gap * (wide.length - 1)) / wide.length;
      frames.set(i, { x: body.x, y: body.y + n * (h + gap), w: wideW, h });
    });
    tall.forEach((i, n) => frames.set(i, { x: body.x + (wide.length > 0 ? wideW + gap : 0) + n * (tallW + gap), y: body.y, w: tallW, h: body.h }));
    cameras.points.forEach((point, i) => {
      const frame = frames.get(i);
      const box = boxes[i];
      if (!frame || !box) return;
      const { x: fx, y: fy, w: fw, h: fh } = frame;
      const eye = centerOf(point);
      // 映る範囲がまるごと入る大きさにして、映像の形に合わせて広げる
      const bw = box.x1 - box.x0;
      const bh = box.y1 - box.y0;
      const per = Math.min(fw / bw, fh / bh);
      const cropW = fw / per;
      const cropH = fh / per;
      const left = (box.x0 + box.x1) / 2 - cropW / 2;
      const top = (box.y0 + box.y1) / 2 - cropH / 2;
      const scale = per / tile;
      ctx.save();
      roundRect(ctx, fx, fy, fw, fh, 10);
      ctx.clip();
      ctx.fillStyle = '#10161a';
      ctx.fillRect(fx, fy, fw, fh);
      ctx.translate(fx, fy);
      ctx.scale(scale, scale);
      ctx.translate(-left * tile, -top * tile);
      const sx = Math.max(0, Math.floor(left * tile));
      const sy = Math.max(0, Math.floor(top * tile));
      const sw = Math.min(shop.width, Math.ceil((left + cropW) * tile)) - sx;
      const sh = Math.min(shop.height, Math.ceil((top + cropH) * tile)) - sy;
      if (sw > 0 && sh > 0) ctx.drawImage(shop.layer, sx, sy, sw, sh, sx, sy, sw, sh);
      // 映っている人（カメラから見通せて、映る距離の中）。奥から手前へ
      const shown = this.members
        .map((member) => ({ member, pose: poses[member.seat] }))
        .filter((e): e is { member: Member; pose: ActorPose } => {
          const pose = e.pose;
          if (!pose || e.member.seat === watcher || (pose.state !== 'a' && pose.state !== 'w' && pose.state !== 'z')) return false;
          return Math.hypot(pose.x - eye.x, pose.y - eye.y) <= cameras.radius && (!this.grid || hasLineOfSight(this.grid, eye, pose));
        })
        .sort((a, b) => a.pose.y - b.pose.y);
      for (const { member, pose } of shown) {
        // 映像は小さいので、人は少し大きめに描く（見分けやすく）
        drawActor(ctx, { ...this.look(member, time), pace, x: pose.x * tile, y: pose.y * tile + tile * 0.3, scale: ACTOR_SCALE * FEED_ACTOR, facing: pose.dx < -0.001 ? -1 : 1, walking: pose.moving, working: pose.state === 'w', asleep: pose.state === 'z', mood: 'normal', wings: false, talk: 0 });
      }
      ctx.restore();
      // 画面らしさ: 緑がかった色・走査線・枠
      ctx.save();
      roundRect(ctx, fx, fy, fw, fh, 10);
      ctx.clip();
      ctx.fillStyle = 'rgba(70, 160, 120, 0.14)';
      ctx.fillRect(fx, fy, fw, fh);
      ctx.fillStyle = 'rgba(0, 0, 0, 0.12)';
      for (let yy = fy + ((time * 30) % 4); yy < fy + fh; yy += 4) ctx.fillRect(fx, yy, fw, 1.5);
      const vignette = ctx.createRadialGradient(fx + fw / 2, fy + fh / 2, Math.min(fw, fh) * 0.35, fx + fw / 2, fy + fh / 2, Math.max(fw, fh) * 0.75);
      vignette.addColorStop(0, 'rgba(0, 0, 0, 0)');
      vignette.addColorStop(1, 'rgba(0, 0, 0, 0.4)');
      ctx.fillStyle = vignette;
      ctx.fillRect(fx, fy, fw, fh);
      if (shown.length > 0) {
        const names = shown.map((e) => e.member.name).join('・');
        drawText(ctx, names, fx + fw / 2, fy + fh - 16, { size: fw < 140 ? 15 : 18, align: 'center', weight: 800, color: '#fff', stroke: '#10161a', strokeWidth: 5 });
      }
      ctx.restore();
      roundRect(ctx, fx, fy, fw, fh, 10);
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#5b666f';
      ctx.stroke();
      // 場所の名前（縦長の映像では、縦書き）
      if (fw < 140) {
        [...point.name].forEach((ch, k) => drawText(ctx, ch, fx + 16, fy + 22 + k * 20, { size: 17, align: 'center', weight: 800, color: '#fff', stroke: '#10161a', strokeWidth: 5 }));
      } else {
        drawText(ctx, point.name, fx + 12, fy + 20, { size: 19, weight: 800, color: '#fff', stroke: '#10161a', strokeWidth: 5 });
      }
      if (Math.floor(time * 2) % 2 === 0) {
        ctx.beginPath();
        ctx.arc(fx + fw - 16, fy + 18, 7, 0, Math.PI * 2);
        ctx.fillStyle = '#ff3b2a';
        ctx.fill();
      }
    });
  }

  /** 工房の道具の、動く部分: 名札かけの名札・防犯カメラの画面の明かり・廊下のカメラの赤いランプ（工房の絵の座標で描く）。 */
  private drawDevicesNow(ctx: Ctx, tile: number, poseTime: number, time: number, inView: (x: number, y: number, pad: number) => boolean): void {
    const devices = this.show.log.roam?.map.devices;
    if (!devices) return;
    const watching = this.show.looks.some((span) => span.device === 'cameras' && poseTime >= span.start && poseTime < span.end);
    const screen = deviceSpot(devices, 'cameras', tile);
    if (screen && watching && inView(screen.cx, screen.base, tile * 3)) drawScreensOn(ctx, screen.cx, screen.base, tile, time);
    for (const camera of devices.cameras?.points ?? []) {
      const mount = cameraMount(camera, tile);
      if (inView(mount.x, mount.y, tile * 2)) drawCameraLamp(ctx, camera, tile, watching, time);
    }
    const board = deviceSpot(devices, 'vitals', tile);
    if (board && inView(board.cx, board.base, tile * 3)) {
      const status = this.statusAt(poseTime);
      const tags = this.members.map((member) => {
        const now = status.get(member.name);
        return { color: member.color.main, dark: member.color.dark, state: now === 'z' ? ('asleep' as const) : now === 'x' ? ('gone' as const) : ('awake' as const) };
      });
      drawNameTags(ctx, board.cx, board.base, tile, tags);
    }
  }

  /** 持ち場で手を動かしている人の上に出す、小さな札（していることと、進み具合）。ratio が null の時は、押さえ続けている。 */
  private workLabel(ctx: Ctx, x: number, y: number, tile: number, text: string, ratio: number | null, tone: 'task' | 'fake' | 'fix' | 'look', time: number): void {
    const size = tile * 0.27;
    setFont(ctx, size, 800);
    const w = Math.max(tile * 1.5, ctx.measureText(text).width + size * 1.3);
    const h = size * 2.3;
    const edge = tone === 'task' ? INK : tone === 'look' ? '#2f5d8a' : '#a3261d';
    ctx.save();
    ctx.translate(x, y);
    roundRect(ctx, -w / 2, -h, w, h, size * 0.5);
    ctx.fillStyle = tone === 'fix' ? '#fff0d6' : tone === 'fake' ? '#ffe3df' : tone === 'look' ? '#eaf3ff' : '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = edge;
    ctx.stroke();
    drawText(ctx, text, 0, -h + size * 0.8, { size, align: 'center', weight: 800, color: tone === 'task' ? INK : tone === 'look' ? '#2f5d8a' : '#a3261d' });
    const bw = w - size;
    const bh = size * 0.4;
    const by = -size * 0.78;
    roundRect(ctx, -bw / 2, by, bw, bh, bh / 2);
    ctx.fillStyle = 'rgba(60, 40, 20, 0.2)';
    ctx.fill();
    ctx.fillStyle = tone === 'task' ? ZUNDA_DARK : tone === 'fake' ? '#d49a93' : tone === 'look' ? '#4a90d9' : '#e67e22';
    if (ratio === null) {
      const p = (Math.sin(time * 5) + 1) / 2;
      roundRect(ctx, -bw / 2 + (bw - bw * 0.32) * p, by, bw * 0.32, bh, bh / 2);
    } else {
      roundRect(ctx, -bw / 2, by, Math.max(bh, bw * clamp01(ratio)), bh, bh / 2);
    }
    ctx.fill();
    ctx.restore();
  }

  /** 画面の上に出す、困りごとの知らせ（あかりが消えた・かまどの焚きすぎ）。直った直後は、その知らせ。 */
  private drawTrouble(ctx: Ctx, now: WorldNow, poses: ActorPose[], poseTime: number, time: number, options: RenderOptions): void {
    const cx = ANCHOR_X + 40;
    const { trouble } = now;
    if (!trouble) {
      const done = this.show.troubles.find((span) => span.how === 'fixed' && poseTime >= span.end && poseTime < span.end + 2.6);
      if (!done) return;
      const life = (poseTime - done.end) / 2.6;
      ctx.save();
      ctx.globalAlpha = hill(life, 0.12);
      ctx.translate(cx, 132);
      ctx.scale(easeBack(life / 0.12), easeBack(life / 0.12));
      plaque(ctx, -300, -34, 600, 68, { radius: 34, fill: '#eef7df', edge: ZUNDA_DARK });
      drawText(ctx, done.what === 'lights' ? 'あかりが戻った！' : 'かまどが落ち着いた！', 0, 2, { size: 36, align: 'center', weight: 900, color: '#3f7d1f' });
      ctx.restore();
      return;
    }
    const crisis = trouble.what === 'crisis';
    const spots = this.spots.filter((spot) => spot.kind === trouble.what);
    const w = 900;
    const h = crisis ? 116 : 88;
    const x = cx - w / 2;
    const y = 98 + (easeBack(trouble.age / 0.4) - 1) * 70;
    const tone = TROUBLE_COLOR[trouble.what];
    ctx.save();
    ctx.globalAlpha = clamp01(trouble.age / 0.2);
    plaque(ctx, x, y, w, h, { radius: 24, fill: crisis ? '#fff1e8' : '#eceaf8', edge: tone });
    // 左の丸い印
    const ix = x + 58;
    const iy = y + h / 2;
    ctx.beginPath();
    ctx.arc(ix, iy, 36, 0, Math.PI * 2);
    ctx.fillStyle = tone;
    ctx.fill();
    if (crisis) {
      // 炎
      const f = 1 + Math.sin(time * 13) * 0.07;
      for (const [scale, fill] of [[1, '#ffb23a'], [0.55, '#fff3b0']] as const) {
        ctx.save();
        ctx.translate(ix, iy + 8);
        ctx.scale(22 * scale * f, 26 * scale * (2 - f));
        ctx.beginPath();
        ctx.moveTo(0, -1.2);
        ctx.bezierCurveTo(1.05, -0.2, 0.85, 0.75, 0, 0.75);
        ctx.bezierCurveTo(-0.85, 0.75, -1.05, -0.2, 0, -1.2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.restore();
      }
    } else {
      // 消えた提灯
      roundRect(ctx, ix - 15, iy - 18, 30, 36, 13);
      ctx.fillStyle = '#8f93c4';
      ctx.fill();
      ctx.fillStyle = '#2a2c58';
      ctx.fillRect(ix - 11, iy - 22, 22, 6);
      ctx.fillRect(ix - 11, iy + 16, 22, 6);
      ctx.strokeStyle = '#2a2c58';
      ctx.lineWidth = 2;
      for (const dy of [-8, 0, 8]) {
        ctx.beginPath();
        ctx.moveTo(ix - 14, iy + dy);
        ctx.lineTo(ix + 14, iy + dy);
        ctx.stroke();
      }
    }
    const tx = x + 112;
    const culprit = options.secrets ? `　${trouble.by}のしわざ` : '';
    if (crisis) {
      const left = trouble.left ?? 0;
      const hurry = left <= 15;
      drawText(ctx, 'かまどが焚きすぎ！', tx, y + 36, { size: 38, weight: 900, color: tone });
      if (culprit) drawText(ctx, culprit.trim(), tx + 366, y + 38, { size: 22, weight: 800, color: '#8f251c' });
      // 直す場所と、押さえている人がいるか
      let cursor = tx;
      spots.forEach((spot, index) => {
        if (index > 0) {
          drawText(ctx, 'と', cursor + 6, y + 84, { size: 22, weight: 800, color: '#7b6248' });
          cursor += 38;
        }
        const held = poses.some((pose) => pose.state === 'w' && Math.hypot(pose.x - spot.x, pose.y - spot.y) < 0.8);
        cursor = this.chip(ctx, cursor, y + 84, `${held ? '◎' : '・'} ${spot.name}`, held ? '#4f8a3a' : '#f1d9cf', held ? '#fff' : '#8f251c', 22) + 4;
      });
      drawText(ctx, 'を、同時に押さえる', cursor + 6, y + 84, { size: 22, weight: 800, color: '#7b6248' });
      // 残りの秒
      const beat = hurry ? 1 + Math.abs(Math.sin(time * 7)) * 0.12 : 1;
      drawText(ctx, 'のこり', x + w - 190, y + 34, { size: 22, weight: 800, color: '#7b6248' });
      ctx.save();
      ctx.translate(x + w - 86, y + 62);
      ctx.scale(beat, beat);
      drawText(ctx, String(Math.ceil(left)), 0, 0, { size: 76, weight: 900, color: tone, align: 'center' });
      ctx.restore();
      drawText(ctx, '秒', x + w - 30, y + 80, { size: 24, weight: 800, color: tone, align: 'center' });
    } else {
      drawText(ctx, 'あかりが消えた！', tx, y + 30, { size: 38, weight: 900, color: tone });
      if (culprit) drawText(ctx, culprit.trim(), tx + 330, y + 32, { size: 22, weight: 800, color: '#8f251c' });
      const where = spots.map((spot) => `${spot.room}の${spot.name}`).join('、');
      drawText(ctx, where ? `${where}を上げると戻る。従業員は、すぐ近くしか見えない` : '従業員は、すぐ近くしか見えない', tx, y + 66, { size: 22, weight: 700, color: '#4d4f86' });
    }
    ctx.restore();
  }

  /** その人がいま出している声（見回りの中のもの）。重なりすぎて鳴らさない声は、画面が散らからないよう、ふきだしも出さない。 */
  private activeChat(name: string, time: number, segment: RoamSegment): Cue | null {
    for (const cue of this.chats) {
      if (cue.at > time) break;
      if (cue.voiced && cue.end > time && cue.at >= segment.start - 0.01 && (cue.event as EventOf<'chat'>).speaker === name) return cue;
    }
    return null;
  }

  /** 声に合わせた口の開き。音声があれば母音に合わせ、無ければ文字が出ている間それらしく動かす。 */
  private mouthOf(cue: Cue, time: number): number {
    const local = time - cue.at;
    const mouth = cue.voiced ? cue.clip?.mouth : undefined;
    if (mouth) return mouthAt(mouth, local);
    return local < (cue.end - cue.at) * 0.8 ? 0.25 + 0.75 * Math.abs(Math.sin(local * 13 + Math.sin(local * 5) * 2)) : 0;
  }

  /** 声のふきだし（話した人の色のふちで、言葉をそのまま出す）。 */
  private speechBalloon(ctx: Ctx, x: number, y: number, text: string, member: Member, style: { size: number; alpha: number; pop: number }): void {
    if (style.alpha <= 0) return;
    const { size } = style;
    const lines = clampLines(wrapText(ctx, `「${text}」`, size * 11, size, 700), 3);
    setFont(ctx, size, 700);
    const w = Math.max(...lines.map((line) => ctx.measureText(line).width)) + size * 1.3;
    const h = lines.length * size * 1.3 + size * 0.75;
    ctx.save();
    ctx.globalAlpha *= style.alpha;
    ctx.translate(x, y);
    ctx.scale(style.pop, style.pop);
    ctx.beginPath();
    ctx.moveTo(-size * 0.45, -2);
    ctx.lineTo(0, size * 0.55);
    ctx.lineTo(size * 0.45, -2);
    ctx.closePath();
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = member.color.dark;
    ctx.stroke();
    roundRect(ctx, -w / 2, -h, w, h, size * 0.6);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(-size * 0.4, -5, size * 0.8, 6);
    lines.forEach((line, n) => drawText(ctx, line, 0, -h + size * 0.38 + size * 0.65 + n * size * 1.3, { size, color: INK, align: 'center', weight: 700 }));
    ctx.restore();
  }

  private activeDecide(name: string, time: number, segment: RoamSegment): Cue | null {
    const list = this.decides.get(name) ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const cue = list[i] as Cue;
      if (cue.at > time) continue;
      return cue.end > time && cue.at >= segment.start ? cue : null;
    }
    return null;
  }

  private bubble(ctx: Ctx, x: number, y: number, text: string, style: { size: number; alpha: number; pop: number; fill: string; color: string }): void {
    if (style.alpha <= 0) return;
    ctx.save();
    ctx.globalAlpha *= style.alpha;
    setFont(ctx, style.size, 700);
    const w = ctx.measureText(text).width + style.size * 1.2;
    const h = style.size * 1.7;
    ctx.translate(x, y);
    ctx.scale(style.pop, style.pop);
    ctx.beginPath();
    ctx.moveTo(-7, -2);
    ctx.lineTo(0, 9);
    ctx.lineTo(7, -2);
    ctx.closePath();
    ctx.fillStyle = style.fill;
    ctx.fill();
    ctx.lineWidth = 2.4;
    ctx.strokeStyle = INK;
    ctx.stroke();
    roundRect(ctx, -w / 2, -h, w, h, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillRect(-6, -4, 12, 5);
    drawText(ctx, text, 0, -h / 2 + 1, { size: style.size, color: style.color, align: 'center', weight: 700 });
    ctx.restore();
  }

  /** 左上の札: 題名と、いまの場面。その右に、仕込みの進み具合。 */
  private drawTopBar(ctx: Ctx, scene: string, time: number): void {
    plaque(ctx, 20, 20, 548, 64, { fill: '#6b4226', edge: '#3f2512', radius: 18 });
    zundaMochi(ctx, 58, 53, 22);
    drawText(ctx, 'ずんだ餅工房のもちもち事件', 92, 53, { size: 30, color: PAPER, weight: 800 });
    plaque(ctx, 582, 20, 256, 64, { radius: 18 });
    drawText(ctx, scene, 710, 53, { size: 28, align: 'center', weight: 800 });

    const progress = progressAt(this.show, time);
    if (!progress) return;
    // 仕込みが1つ終わった時は、少しのあいだ、はずむ
    this.drawProgress(ctx, 852, 20, RIGHT_X - 14 - 852, 64, progress, hill((time - progress.since) / 0.7, 0.3));
  }

  /** 仕込みの進み具合の札（見回りの上の帯と、集会の左上で使う）。bump が 0 より大きい間は、はずむ。 */
  private drawProgress(ctx: Ctx, x: number, y: number, w: number, h: number, progress: { done: number; total: number; ratio: number }, bump: number): void {
    plaque(ctx, x, y, w, h, { radius: 18, fill: bump > 0 ? '#f3f7dc' : PAPER });
    const by = y + h / 2 + 1;
    drawText(ctx, '仕込み', x + 20, by, { size: 24, color: '#7b6248', weight: 800 });
    // 棒の右には、数（77/112 など）の幅と、端の餅がはみ出す分をあける
    setFont(ctx, 30, 800);
    const count = `${progress.done}/${progress.total}`;
    const bx = x + 110;
    const bw = w - 110 - (ctx.measureText(count).width + 18 + 34);
    const bh = 24;
    roundRect(ctx, bx, by - bh / 2, bw, bh, bh / 2);
    ctx.fillStyle = '#e3d3b0';
    ctx.fill();
    ctx.save();
    ctx.clip();
    const fill = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    fill.addColorStop(0, ZUNDA);
    fill.addColorStop(1, ZUNDA_DARK);
    ctx.fillStyle = fill;
    ctx.fillRect(bx, by - bh / 2, bw * progress.ratio, bh);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.28)';
    ctx.fillRect(bx, by - bh / 2, bw * progress.ratio, bh * 0.36);
    ctx.restore();
    ctx.fillStyle = 'rgba(94, 59, 34, 0.45)';
    for (const tick of [0.25, 0.5, 0.75]) ctx.fillRect(bx + bw * tick - 1, by - bh / 2 + 3, 2, bh - 6);
    roundRect(ctx, bx, by - bh / 2, bw, bh, bh / 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = WOOD_DARK;
    ctx.stroke();
    zundaMochi(ctx, bx + bw * progress.ratio, by, 15 * (1 + bump * 0.45));
    drawText(ctx, count, x + w - 18, by + 1, { size: 30, weight: 800, align: 'right', color: bump > 0 ? '#3f7d1f' : INK });
  }

  /**
   * 右上の札: 工房の時計（見回りがはじまってからの時刻）。制限時間の無い試合で出す。集会で「36秒ごろ」「1分10秒ごろ」と言うのと同じ数え方。
   */
  private drawTimer(ctx: Ctx, clock: number): void {
    const total = Math.max(0, Math.floor(clock));
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    plaque(ctx, RIGHT_X, 20, RIGHT_W, 64, { radius: 18, fill: PAPER });
    // 時計の絵（丸と、秒で回る針）
    const cx = RIGHT_X + 40;
    const cy = 52;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, 17, 0, Math.PI * 2);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = INK;
    ctx.stroke();
    const angle = (clock % 60) / 60 * Math.PI * 2 - Math.PI / 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(angle) * 12, cy + Math.sin(angle) * 12);
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#c0392b';
    ctx.stroke();
    ctx.restore();
    drawText(ctx, '工房の時計', RIGHT_X + 70, 53, { size: 22, color: '#7b6248', weight: 700 });
    // 数字は右にそろえて、桁が変わっても揺れないようにする
    const right = RIGHT_X + RIGHT_W - 24;
    drawText(ctx, '秒', right, 56, { size: 24, weight: 800, color: INK, align: 'right' });
    drawText(ctx, String(seconds).padStart(minutes > 0 ? 2 : 1, '0'), right - 30, 54, { size: 38, weight: 900, color: INK, align: 'right' });
    if (minutes > 0) {
      drawText(ctx, '分', right - 84, 56, { size: 24, weight: 800, color: INK, align: 'right' });
      drawText(ctx, String(minutes), right - 114, 54, { size: 38, weight: 900, color: INK, align: 'right' });
    }
  }

  /** 右上の札: 開店までの時計。 */
  private drawClock(ctx: Ctx, clock: number): void {
    const left = Math.max(0, this.show.opening - clock);
    const progress = this.show.opening > 0 ? clamp01(clock / this.show.opening) : 1;
    const hurry = left <= 30;
    plaque(ctx, RIGHT_X, 20, RIGHT_W, 64, { radius: 18, fill: hurry ? '#ffe9c9' : PAPER });
    drawText(ctx, '開店まで', RIGHT_X + 18, 53, { size: 22, color: '#7b6248', weight: 700 });
    drawText(ctx, clockLabel(left), RIGHT_X + 116, 54, { size: 34, weight: 800, color: hurry ? '#c0392b' : INK });
    const bx = RIGHT_X + 206;
    const bw = RIGHT_W - 206 - 30;
    const by = 53;
    roundRect(ctx, bx, by - 8, bw, 16, 8);
    const sky = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    sky.addColorStop(0, '#39437a');
    sky.addColorStop(0.7, '#e88f6a');
    sky.addColorStop(1, '#ffd766');
    ctx.fillStyle = sky;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = WOOD_DARK;
    ctx.stroke();
    // 進んだ分だけ日がのぼる
    ctx.beginPath();
    ctx.arc(bx + bw * progress, by, 13, 0, Math.PI * 2);
    ctx.fillStyle = '#ffcf40';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  /** 右の見取り図: 工房の全体と、全員の居場所、いま映している範囲。下端の高さを返す。 */
  private drawMini(ctx: Ctx, shop: Workshop, poses: ActorPose[], now: WorldNow, camera: Camera, poseTime: number, time: number, options: RenderOptions): number {
    const pad = 9;
    const scale = Math.min((RIGHT_W - pad * 2) / shop.mini.width, 250 / shop.mini.height);
    const mw = shop.mini.width * scale;
    const mh = shop.mini.height * scale;
    const top = 96;
    plaque(ctx, RIGHT_X, top, RIGHT_W, mh + pad * 2, { radius: 16, fill: '#3a2516', edge: '#2a180c' });
    const mx = RIGHT_X + (RIGHT_W - mw) / 2;
    const my = top + pad;
    const unit = shop.miniTile * scale; // 升目1つの大きさ
    ctx.save();
    roundRect(ctx, mx, my, mw, mh, 8);
    ctx.clip();
    ctx.drawImage(shop.mini, mx, my, mw, mh);
    // 部屋の名前
    for (const room of shop.rooms) {
      const size = Math.min(15, Math.max(10, (room.w * unit - 6) / [...room.name].length));
      drawText(ctx, room.name, mx + (room.x + room.w / 2) * unit, my + (room.y + room.h / 2) * unit, { size, align: 'center', weight: 800, color: 'rgba(59, 42, 30, 0.72)' });
    }
    // 抜け道の揚げ板（小さな四角）と、閉まった戸（赤い線と、うす赤い部屋）
    ctx.fillStyle = 'rgba(70, 42, 18, 0.7)';
    for (const hatch of this.show.log.roam?.map.hatches ?? []) ctx.fillRect(mx + (hatch.x + 0.12) * unit, my + (hatch.y + 0.12) * unit, unit * 0.76, unit * 0.76);
    for (const span of now.shut) {
      const room = shop.rooms.find((r) => r.name === span.room);
      if (room) {
        ctx.fillStyle = 'rgba(192, 57, 43, 0.3)';
        ctx.fillRect(mx + room.x * unit, my + room.y * unit, room.w * unit, room.h * unit);
      }
      ctx.fillStyle = '#a3261d';
      for (const door of this.doorRects[span.room] ?? []) {
        const pad = door.h === 1 ? [0, 0.15] : [0.15, 0];
        ctx.fillRect(mx + (door.x - (pad[0] as number)) * unit, my + (door.y - (pad[1] as number)) * unit, (door.w + (pad[0] as number) * 2) * unit, (door.h + (pad[1] as number) * 2) * unit);
      }
    }
    // あかりが消えている間は、見取り図も暗い
    if (now.dark > 0.01) {
      ctx.fillStyle = `rgba(8, 10, 30, ${0.68 * now.dark})`;
      ctx.fillRect(mx, my, mw, mh);
    }
    // 困りごとを直す場所（点滅する印）
    const { trouble } = now;
    if (trouble) {
      const blink = 0.5 + 0.5 * Math.sin(time * 8);
      for (const spot of this.spots) {
        if (spot.kind !== trouble.what) continue;
        const held = poses.some((pose) => pose.state === 'w' && Math.hypot(pose.x - spot.x, pose.y - spot.y) < 0.8);
        const x = mx + spot.x * unit;
        const y = my + spot.y * unit;
        ctx.beginPath();
        ctx.arc(x, y, 9 + blink * 5, 0, Math.PI * 2);
        ctx.strokeStyle = held ? 'rgba(90, 190, 90, 0.95)' : trouble.what === 'crisis' ? `rgba(240, 60, 40, ${0.5 + blink * 0.5})` : `rgba(250, 200, 60, ${0.5 + blink * 0.5})`;
        ctx.lineWidth = 3.5;
        ctx.stroke();
      }
    }
    // いま映している範囲
    const vw = W / camera.zoom;
    const vh = H / camera.zoom;
    const left = camera.x - ANCHOR_X / camera.zoom;
    const up = camera.y - ANCHOR_Y / camera.zoom;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
    ctx.fillRect(mx + left * unit, my + up * unit, vw * unit, vh * unit);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    ctx.lineWidth = 2.5;
    ctx.strokeRect(mx + left * unit, my + up * unit, vw * unit, vh * unit);
    // 心だけの人（うすい輪）
    for (const member of this.members) {
      const ghost = now.ghosts[member.seat];
      if (!ghost) continue;
      ctx.beginPath();
      ctx.arc(mx + ghost.x * unit, my + ghost.y * unit, 5, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(214, 222, 255, 0.55)';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = member.color.light;
      ctx.stroke();
    }
    // 全員の居場所
    for (const member of this.members) {
      const pose = poses[member.seat];
      if (!pose || pose.state === 'x') continue;
      const x = mx + pose.x * unit;
      const y = my + pose.y * unit;
      const culprit = options.secrets && member.role !== 'artisan';
      if (pose.state === 'u') {
        // 床下を進んでいる人は、役職を見せている時だけ、点線と中抜きの丸で出す
        const span = options.secrets ? this.show.sneaks.find((sneak) => sneak.seat === member.seat && poseTime >= sneak.start && poseTime < sneak.end) : undefined;
        if (!span) continue;
        const to = span.to ?? span.from;
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.lineWidth = 2;
        ctx.strokeStyle = 'rgba(192, 57, 43, 0.95)';
        ctx.beginPath();
        ctx.moveTo(mx + span.from.x * unit, my + span.from.y * unit);
        ctx.lineTo(mx + to.x * unit, my + to.y * unit);
        ctx.stroke();
        ctx.restore();
        ctx.beginPath();
        ctx.arc(x, y, 5.5, 0, Math.PI * 2);
        ctx.fillStyle = '#2e120e';
        ctx.fill();
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = '#c0392b';
        ctx.stroke();
        continue;
      }
      if (member.seat === camera.subject) {
        ctx.beginPath();
        ctx.arc(x, y, 11 + Math.sin(time * 5) * 1.5, 0, Math.PI * 2);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2.5;
        ctx.stroke();
      }
      if (pose.state === 'z') {
        // ずんだ餅になった人は、小さな餅の印
        zundaMochi(ctx, x, y, 7.5);
        continue;
      }
      ctx.beginPath();
      ctx.arc(x, y, 6.5, 0, Math.PI * 2);
      ctx.fillStyle = member.color.main;
      ctx.fill();
      ctx.lineWidth = culprit ? 3 : 2;
      ctx.strokeStyle = culprit ? ROLE_COLOR[member.role] : '#fff';
      ctx.stroke();
    }
    ctx.restore();
    // かまどの焚きすぎの間は、見取り図の枠も赤く脈うつ
    if (trouble?.what === 'crisis') {
      roundRect(ctx, RIGHT_X, top, RIGHT_W, mh + pad * 2, 16);
      ctx.lineWidth = 5;
      ctx.strokeStyle = `rgba(214, 58, 47, ${0.45 + 0.55 * Math.abs(Math.sin(time * 4))})`;
      ctx.stroke();
    }
    return top + mh + pad * 2;
  }

  /** 右の名簿。人数に合わせて、札の高さを変える。 */
  private drawCast(ctx: Ctx, segment: RoamSegment, poses: ActorPose[], now: WorldNow, poseTime: number, time: number, options: RenderOptions, subject: number | null, top: number): void {
    const status = this.statusAt(poseTime);
    const count = this.members.length;
    const gap = count > 8 ? 5 : 8;
    const y0 = top + 12;
    const cardH = Math.min(96, (STRIP_Y - 12 - y0 - gap * (count - 1)) / count);
    const big = cardH >= 78;
    const tiny = cardH < 56;
    this.members.forEach((member, i) => {
      const y = y0 + i * (cardH + gap);
      const state = status.get(member.name);
      const gone = state === 'x';
      const asleep = state === 'z';
      const culprit = options.secrets && member.role === 'nibbler';
      const sided = options.secrets && member.role !== 'artisan';
      const watched = member.seat === subject;
      plaque(ctx, RIGHT_X, y, RIGHT_W, cardH, { radius: 14, fill: gone ? '#e4dccb' : asleep ? '#eef5e0' : PAPER, edge: sided ? ROLE_COLOR[member.role] : WOOD_DARK });
      if (watched) {
        // いまカメラが追っている人
        ctx.save();
        roundRect(ctx, RIGHT_X - 3, y - 3, RIGHT_W + 6, cardH + 6, 16);
        ctx.lineWidth = 5;
        ctx.strokeStyle = '#f2b632';
        ctx.stroke();
        ctx.restore();
      }
      const r = Math.min(34, cardH / 2 - 6);
      drawPortrait(ctx, RIGHT_X + 14 + r, y + cardH / 2, r, { ...this.look(member, time), asleep, dim: gone, mood: culprit ? 'sly' : 'normal' });
      const tx = RIGHT_X + 14 + r * 2 + 12;
      const right = RIGHT_X + RIGHT_W - 12;
      const nameSize = big ? 26 : tiny ? 20 : 23;
      const line1 = tiny ? y + cardH / 2 : y + cardH * (big ? 0.32 : 0.3);
      drawText(ctx, member.name, tx, line1, { size: nameSize, weight: 800, color: gone ? '#8d877a' : INK });
      setFont(ctx, nameSize, 800);
      let cursor = tx + ctx.measureText(member.name).width + 8;
      if (options.secrets) cursor = this.chip(ctx, cursor, line1, tiny ? ROLE_SHORT[member.role] : ROLE_LABEL[member.role], ROLE_COLOR[member.role], '#fff', tiny ? 14 : 16) + 6;

      const intent = this.lastDecide(member.name, poseTime, segment.start);
      const hidden = intent !== null && SECRET_ACTIONS.has(intent.action) && !options.secrets;
      const pose = poses[member.seat];
      const spot = pose?.state === 'w' ? this.spotAt(pose.x, pose.y) : null;
      // 占い師と、条件つきの試合の狐の仕込みは本物なので、「（ふり）」と書かない（2026-11-21。前は、従業員でない人はみな「ふり」と出ていた）
      const fake = options.secrets && this.fakeWork(member.role) && spot?.kind === 'station';
      const under = options.secrets && pose?.state === 'u';
      let doing = gone ? 'クビになった' : asleep ? (now.ghosts[member.seat] ? '心だけで仕込み中' : 'ずんだ餅になった') : '見回り中';
      let brief = doing;
      if (!gone && !asleep) {
        if (under) doing = brief = '床下を移動中';
        else if (spot) doing = brief = spot.kind === 'station' ? (fake ? `${spot.name}（ふり）` : spot.name) : spot.kind === 'lights' ? 'ブレーカーを上げている' : `${spot.name}を押さえている`;
        else if (intent && intent.applied && !hidden) {
          doing = this.actionText(intent, true, options.secrets);
          brief = this.actionText(intent, false, options.secrets).replace(/[！…]+$/, '');
        }
      }
      const nowColor = gone ? '#8d877a' : asleep ? MOCHI_INK : under || fake ? '#a3261d' : spot && spot.kind !== 'station' ? '#c2571a' : '#5a7a2c';
      if (tiny) {
        // 1行だけの札: 名前の右に、いましていること。長い言い回しが入らなければ短く、それでも入らなければ字を小さく
        const room = right - cursor - 4;
        setFont(ctx, 16, 700);
        const said = ctx.measureText(doing).width <= room ? doing : brief;
        const size = Math.max(13, Math.min(16, (16 * room) / Math.max(1, ctx.measureText(said).width)));
        const text = clampLines(wrapText(ctx, said, room, size, 700), 1)[0] ?? '';
        drawText(ctx, text, right, line1, { size, weight: 700, color: nowColor, align: 'right' });
        return;
      }
      // 頭脳の札は、収まる呼び名で出す
      const short = member.brain.replace(/^(Claude|GPT-\d+(\.\d+)?) /, '');
      const fits = ([[member.brain, 15], [short, 15], [short, 13]] as const).find(([label, size]) => {
        setFont(ctx, size, 700);
        return ctx.measureText(label).width + size <= right - cursor;
      });
      if (fits) {
        setFont(ctx, fits[1], 700);
        this.chip(ctx, right - ctx.measureText(fits[0]).width - fits[1], line1, fits[0], '#e9dcc0', '#6b5134', fits[1]);
      }
      const size = big ? 20 : 18;
      drawText(ctx, clampLines(wrapText(ctx, doing, right - tx, size, 700), 1)[0] ?? '', tx, y + cardH * (big ? 0.7 : 0.72), { size, weight: 700, color: nowColor });
    });
  }

  private chip(ctx: Ctx, x: number, y: number, text: string, fill: string, color: string, size = 18): number {
    setFont(ctx, size, 700);
    const w = ctx.measureText(text).width + size;
    const h = size + 10;
    roundRect(ctx, x, y - h / 2, w, h, h / 2);
    ctx.fillStyle = fill;
    ctx.fill();
    drawText(ctx, text, x + w / 2, y + 1, { size, color, align: 'center', weight: 700 });
    return x + w;
  }

  /** 下の帯: いま起きたこと。静かな時は、カメラが追っている人の内心を出す。 */
  private drawStrip(ctx: Ctx, segment: RoamSegment, poseTime: number, time: number, options: RenderOptions, camera: Camera): void {
    let headline: Headline | null = null;
    for (const h of this.headlines) if (h.at <= poseTime && h.at >= segment.start - 0.01 && (options.secrets || !h.secretOnly)) headline = h;
    const fresh = headline !== null && poseTime - headline.at < (headline.alert ? 5.5 : 4);
    const member = camera.subject !== null ? (this.members[camera.subject] ?? null) : null;
    const asleep = member !== null && this.statusAt(poseTime).get(member.name) !== undefined;
    const voice = !fresh && member !== null && !asleep;
    const alert = fresh && headline !== null && headline.alert;
    const culprit = voice && options.secrets && isOutsider(member.role);

    let label = 'できごと';
    let text = headline ? (options.secrets ? headline.text : (headline.plain ?? headline.text)) : '';
    let color: string = INK;
    let labelFill: string = alert ? '#c0392b' : ZUNDA_DARK;
    let since = headline?.at ?? segment.start;
    if (voice) {
      const intent = this.lastDecide(member.name, poseTime, segment.start);
      const cue = (this.decides.get(member.name) ?? []).filter((c) => c.at <= poseTime && c.at >= segment.start).at(-1);
      const hidden = intent !== null && SECRET_ACTIONS.has(intent.action);
      if (options.secrets) {
        label = `${member.name}の内心`;
        text = intent ? plainThought(intent.thought) : `（${member.persona}）さて、どこから見て回ろうかな。`;
        color = culprit ? '#8f251c' : INK;
      } else {
        label = member.name;
        text = intent && intent.applied && !hidden ? this.actionText(intent, true, false) : '見回り中';
      }
      labelFill = culprit ? ROLE_COLOR[member.role] : member.color.dark;
      since = Math.max(cue?.at ?? segment.start, camera.shot.start);
    }

    plaque(ctx, 20, STRIP_Y, W - 40, STRIP_H, { radius: 22, fill: alert ? '#fff0d6' : culprit ? '#fbe9e6' : PAPER, edge: alert ? '#c0392b' : culprit ? '#a3261d' : WOOD_DARK });
    const cy = STRIP_Y + STRIP_H / 2;
    let x = 40;
    if (voice) {
      drawPortrait(ctx, x + 40, cy, 40, { ...this.look(member, time), mood: culprit ? 'sly' : 'normal' });
      x += 92;
    }
    setFont(ctx, 24, 800);
    const lw = ctx.measureText(label).width + 36;
    roundRect(ctx, x, cy - 24, lw, 48, 24);
    ctx.fillStyle = labelFill;
    ctx.fill();
    drawText(ctx, label, x + lw / 2, cy + 1, { size: 24, color: '#fff', align: 'center', weight: 800 });
    const tx = x + lw + 22;
    // 長い内心は、文字を少し小さくして3行にし、切らずに出す
    const room = W - tx - 56;
    const fit = fitText(ctx, text, [{ width: room, size: 30, max: 2 }, { width: room, size: 26, max: 3 }], 700);
    const { rows: lines } = fit;
    const size = fit.frame.size;
    const lead = size === 30 ? 40 : 33;
    const pop = easeOut((poseTime - since) / 0.35);
    lines.forEach((line, n) => drawText(ctx, line, tx + (1 - pop) * 30, cy + (n - (lines.length - 1) / 2) * lead + 1, { size, weight: 700, color, alpha: pop }));
  }

  // ───────── 鐘 ─────────

  private drawBellOverlay(ctx: Ctx, segment: MeetingSegment, local: number): void {
    const k = clamp01(local / 0.35);
    ctx.save();
    ctx.globalAlpha = easeOut(k) * 0.62;
    ctx.fillStyle = '#1b1208';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    const cx = W / 2;
    // 鐘（2回鳴る）
    const swing = Math.sin(local * 9.5) * Math.exp(-((local % 1.5) * 1.3));
    const drop = easeBack(local / 0.45);
    ctx.save();
    ctx.translate(0, (drop - 1) * 300);
    // 鳴っている輪
    for (let i = 0; i < 4; i++) {
      const ring = (local * 0.9 + i / 4) % 1;
      ctx.beginPath();
      ctx.arc(cx, 330, 120 + ring * 330, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(255, 214, 110, ${(1 - ring) * 0.5})`;
      ctx.lineWidth = 10 * (1 - ring) + 1;
      ctx.stroke();
    }
    drawBell(ctx, cx, 330, 120, swing);
    for (const [i, side] of [-1, 1].entries()) {
      const wobble = Math.sin(local * 7 + i) * 6;
      drawText(ctx, 'カラン', cx + side * 330, 250 + wobble + i * 40, { size: 74, color: '#ffd766', stroke: '#5e3b22', strokeWidth: 14, align: 'center', weight: 900 });
    }
    ctx.restore();

    // 告知
    const pop = easeBack((local - 0.5) / 0.4);
    if (local > 0.5) {
      ctx.save();
      ctx.translate(cx, 690);
      ctx.scale(pop, pop);
      plaque(ctx, -760, -150, 1520, 300, { radius: 34, fill: PAPER, edge: '#c0392b' });
      // きっかけ: ずんだ餅になった人を見つけた知らせか、中庭の鐘か（古い記録には区別が無い）
      const kind = segment.info.kind === 'bell' ? '中庭の鐘で集合' : segment.info.kind === 'report' ? '餅になった人を発見' : '';
      setFont(ctx, 60, 900);
      const titleW = ctx.measureText(`集会${segment.info.meeting}`).width;
      setFont(ctx, 30, 800);
      const kindW = kind ? ctx.measureText(kind).width + 30 + 24 : 0;
      drawText(ctx, `集会${segment.info.meeting}`, -(titleW + kindW) / 2, -92, { size: 60, color: '#c0392b', weight: 900 });
      if (kind) this.chip(ctx, -(titleW + kindW) / 2 + titleW + 24, -90, kind, segment.info.kind === 'bell' ? '#d9822b' : ZUNDA_DARK, '#fff', 30);
      const lines = clampLines(wrapText(ctx, this.meetingReason(segment.info), 1440, 38, 700), 3);
      lines.forEach((line, n) => drawText(ctx, line, 0, 6 + (n - (lines.length - 1) / 2) * 54 + 12, { size: 38, align: 'center', weight: 700 }));
      ctx.restore();
    }
  }

  // ───────── 集会 ─────────

  /** 集会のきっかけの文。鐘で集まった時は、餅になった人の知らせではないことも添える。 */
  private meetingReason(info: EventOf<'meeting_start'>): string {
    if (info.kind === 'bell') return `${info.reporter}が、中庭の鐘を鳴らして みんなを集めた。\n餅になった人の知らせではない。話したいことがあるようだ`;
    return info.reason;
  }

  /** 集会の席。人数が多い時は、横に広げて、少し小さく描く。 */
  private seatsOf(segment: MeetingSegment): Seat[] {
    const attendees = segment.info.attendees.map((name) => this.byName.get(name)).filter((m): m is Member => m !== undefined);
    const n = attendees.length;
    const spread = n > 8 ? 1660 : Math.min(1500, 300 * n);
    const gap = n > 1 ? spread / (n - 1) : 300;
    const scale = Math.min(3.1, gap / 57);
    return attendees.map((member, i) => {
      const k = n === 1 ? 0.5 : i / (n - 1);
      return { member, x: W / 2 + (k - 0.5) * spread, y: 596 - Math.sin(k * Math.PI) * 46, scale, gap };
    });
  }

  /** 全員を横に並べる時の位置と大きさ。8人より多い時は、奥と手前の2列に分ける（手前の列は、奥の列のあいだに立つ）。 */
  private lineup(baseY: number): { x: number; y: number; size: number }[] {
    const n = this.members.length;
    if (n <= 8) {
      const spread = Math.min(1560, 290 * n);
      return this.members.map((_, i) => ({ x: W / 2 + ((n === 1 ? 0.5 : i / (n - 1)) - 0.5) * spread, y: baseY, size: 1 }));
    }
    const back = Math.ceil(n / 2);
    const step = Math.min(290, 1640 / back);
    return this.members.map((_, i) => {
      const inBack = i < back;
      const count = inBack ? back : n - back;
      const j = inBack ? i : i - back;
      return { x: W / 2 + (j - (count - 1) / 2) * step, y: baseY + (inBack ? -200 : 50), size: inBack ? 0.74 : 0.82 };
    });
  }

  private drawMeeting(ctx: Ctx, segment: MeetingSegment, time: number, options: RenderOptions): void {
    const clock = clockAt(this.show, segment.start);
    const daylight = this.show.opening > 0 ? clamp01(clock / this.show.opening) : 1;
    drawMeetingRoom(ctx, W, H, time, daylight);

    const seats = this.seatsOf(segment);
    const voting = segment.voteStart > 0 && time >= segment.voteStart;
    const revealed = voting && time >= segment.revealAt;
    const decided = voting && segment.result !== null && time >= segment.resultAt;
    const speaking = voting ? null : (this.show.cues.find((c) => c.event.type === 'speak' && time >= c.at && time < c.end && c.at >= segment.start && c.at < segment.end) ?? null);
    const speak = speaking ? (speaking.event as EventOf<'speak'>) : null;
    const speakerSeat = speak ? seats.find((s) => s.member.name === speak.speaker) : undefined;
    const ejected = segment.result?.ejected ?? null;

    // 話している人の後ろに、明かり
    if (speakerSeat) {
      const g = ctx.createRadialGradient(speakerSeat.x, speakerSeat.y - 90, 20, speakerSeat.x, speakerSeat.y - 90, 240);
      g.addColorStop(0, 'rgba(255, 244, 190, 0.75)');
      g.addColorStop(1, 'rgba(255, 244, 190, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(speakerSeat.x - 240, speakerSeat.y - 330, 480, 480);
    }

    // 登場人物
    for (const seat of seats) {
      const { member } = seat;
      const isSpeaker = speak?.speaker === member.name;
      const local = speaking ? time - speaking.at : 0;
      const length = speaking ? speaking.end - speaking.at : 1;
      let mood: Mood = 'normal';
      let alpha = 1;
      let dy = 0;
      let hop = 0;
      let talk = 0;
      if (isSpeaker) {
        hop = Math.abs(Math.sin(local * 5)) * 0.05 + 0.03;
        // 音声があれば、音声の中の母音に合わせて口を開く。無ければ、文字が出ている間それらしく動かす
        const mouth = speaking?.clip?.mouth;
        talk = mouth ? mouthAt(mouth, local) : local < length * 0.82 ? 0.25 + 0.75 * Math.abs(Math.sin(local * 13 + Math.sin(local * 5) * 2)) : 0;
      } else if (speak && speak.suspect === member.name) {
        mood = 'worried';
      }
      if (options.secrets && isOutsider(member.role) && !isSpeaker && !decided) mood = mood === 'worried' ? 'worried' : 'sly';
      if (voting && !revealed) mood = 'normal';
      if (decided && ejected === member.name) {
        // クビの場面では、本人は手前に大きく出るので、席からはすぐに消す
        const k = clamp01((time - segment.resultAt) / 0.25);
        mood = 'worried';
        alpha = 1 - easeInOut(k);
        dy = easeInOut(k) * 20;
      } else if (decided && segment.result) {
        // 従業員側から見て、よい結果か（妖精をクビにした）
        const good = segment.result.ejectedRole === 'nibbler';
        if (options.secrets) mood = SIDE_OF[member.role] === 'nibbler' ? (good ? 'worried' : ejected ? 'sly' : 'happy') : good ? 'happy' : ejected ? 'worried' : 'normal';
      }
      const lookX = speakerSeat && !isSpeaker ? Math.sign(speakerSeat.x - seat.x) : 0;
      const scale = seat.scale * (isSpeaker ? 1.13 : 1);
      if (alpha > 0.01) {
        drawActor(ctx, { ...this.look(member, time), x: seat.x, y: seat.y + dy, scale, hop, talk, lookX, mood, alpha, facing: lookX === 0 ? 1 : (lookX as -1 | 1), wings: options.secrets && member.role === 'nibbler', tail: options.secrets && member.role === 'fox', orb: options.secrets && member.role === 'seer' });
        this.nameTag(ctx, seat.x, seat.y + 34 + dy, member, isSpeaker, options.secrets, alpha, Math.min(1, seat.gap / 172));
      }
    }

    const phase = decided ? '結果' : voting ? '投票' : '話し合い';
    const hx = MEETING_HEAD.x;
    if (!options.bare) {
      plaque(ctx, hx, MEETING_HEAD.y, MEETING_HEAD.w, 84, { fill: '#c0392b', edge: '#7d1f17', radius: 20 });
      drawText(ctx, `集会${segment.info.meeting}`, hx + 28, MEETING_HEAD.y + 44, { size: 42, color: '#fff', weight: 900 });
      drawText(ctx, phase, hx + MEETING_HEAD.w - 26, MEETING_HEAD.y + 46, { size: 28, color: '#ffe3b0', weight: 800, align: 'right' });
    }
    const progress = options.bare ? null : progressAt(this.show, segment.start);
    if (progress) this.drawProgress(ctx, hx, MEETING_HEAD.y + 94, MEETING_HEAD.w, 60, progress, 0);
    if (!options.bare) this.drawMochiFaces(ctx, segment, hx, this.mochiFacesTop(), MEETING_HEAD.w, time);
    // 左上の札の下のふち（「あやしい」の弧を、これより下に通す）
    this.meetingHeadBottom = this.mochiFaces(segment).length > 0 ? this.mochiFacesTop() + MOCHI_FACE.r * 2 + 4 : MEETING_HEAD.y + (this.show.log.roam?.config.deadline !== 0 ? 200 : 154);
    if (!options.bare && this.show.log.roam?.config.deadline !== 0) {
      // 制限時間のある試合（前の仕様の記録）だけ、開店までの時計
      const left = Math.max(0, this.show.opening - clock);
      drawText(ctx, `開店まで${clockLabel(left)}（集会中は止まる）`, hx + 6, MEETING_HEAD.y + 186, { size: 22, color: '#5e4a36', weight: 700, stroke: 'rgba(255,255,255,0.75)', strokeWidth: 5 });
    }
    // 右上: 工房の地図（発言に出た部屋を光らせる。話に場所の名前がたくさん出るので）。
    // 投票の札は端の席の上に立って地図と重なるので、投票が始まったら消す（投票の間は、話に出る部屋が無い）
    const mapAlpha = voting ? 1 - clamp01((time - segment.voteStart) / 0.25) : 1;
    if (this.shop && mapAlpha > 0 && !options.bare) {
      ctx.save();
      ctx.globalAlpha *= mapAlpha;
      this.drawMeetingMap(ctx, this.shop, segment, voting ? null : speak, time);
      ctx.restore();
    }

    if (!voting && speaking && speak && speakerSeat) {
      // 素の表示では、字幕・内心・「あやしい」の矢印は呼ぶ側が描く
      if (!options.bare) this.drawSpeech(ctx, speaking, speak, speakerSeat, seats, time, options);
    } else if (voting) {
      this.drawVote(ctx, segment, seats, time, options);
    }
  }

  /** 名札。badge が true なら、従業員でない人に役職の札を添える（役職を見せている時）。 */
  private nameTag(ctx: Ctx, x: number, y: number, member: Member, strong: boolean, badge: boolean, alpha: number, shrink = 1): void {
    ctx.save();
    ctx.globalAlpha *= alpha;
    const size = (strong ? 34 : 30) * shrink;
    setFont(ctx, size, 800);
    const w = ctx.measureText(member.name).width + 44 * shrink;
    roundRect(ctx, x - w / 2, y - size * 0.72, w, size * 1.44, size * 0.72);
    ctx.fillStyle = member.color.main;
    ctx.fill();
    ctx.lineWidth = strong ? 5 : 3.5;
    ctx.strokeStyle = strong ? '#fff' : member.color.dark;
    ctx.stroke();
    drawText(ctx, member.name, x, y + 1, { size, color: '#fff', align: 'center', weight: 800, stroke: member.color.dark, strokeWidth: 5 });
    // 名前の下に、頭脳の札（どの AI か、集会のあいだずっと見えるように）
    const chip = Math.max(15, (strong ? 21 : 19) * shrink);
    drawBrainChip(ctx, x, y + size * 0.78 + chip * 0.82, member.brainId, chip, { short: true, align: 'center' });
    const below = y + size * 0.78 + chip * 1.6 + 4;
    if (badge && member.role !== 'artisan') {
      const small = Math.max(16, 20 * shrink);
      // 席の間が狭い時は、短い呼び名にする
      const label = shrink < 0.85 ? ROLE_SHORT[member.role] : ROLE_LABEL[member.role];
      setFont(ctx, small, 800);
      const tw = ctx.measureText(label).width + small * 1.1;
      roundRect(ctx, x - tw / 2, below, tw, small * 1.5, small * 0.75);
      ctx.fillStyle = ROLE_COLOR[member.role];
      ctx.fill();
      drawText(ctx, label, x, below + small * 0.8, { size: small, color: '#fff', align: 'center', weight: 800 });
    }
    ctx.restore();
  }

  /** 集会の地図。発言に出た部屋を黄色く光らせ、ずんだ餅が見つかった部屋に印をつける。 */
  private drawMeetingMap(ctx: Ctx, shop: Workshop, segment: MeetingSegment, speak: EventOf<'speak'> | null, time: number): void {
    const box = MEETING_MAP;
    const pad = 10;
    const scale = Math.min((box.w - pad * 2) / shop.mini.width, (box.h - pad * 2) / shop.mini.height);
    const mw = shop.mini.width * scale;
    const mh = shop.mini.height * scale;
    const mx = box.x + (box.w - mw) / 2;
    const my = box.y + (box.h - mh) / 2;
    plaque(ctx, mx - pad, my - pad, mw + pad * 2, mh + pad * 2, { radius: 18, fill: '#3a2516', edge: '#2a180c', shadow: true });
    const unit = shop.miniTile * scale;
    ctx.save();
    roundRect(ctx, mx, my, mw, mh, 8);
    ctx.clip();
    ctx.drawImage(shop.mini, mx, my, mw, mh);
    // 発言に出た部屋（長い名前から先に探す。「北の廊下」の中の「廊下」を、別に数えないように）
    const said = speak?.say ?? '';
    const named = new Set<string>();
    let rest = said;
    for (const room of [...shop.rooms].sort((a, b) => b.name.length - a.name.length)) {
      if (rest.includes(room.name)) {
        named.add(room.name);
        rest = rest.split(room.name).join('　');
      }
    }
    // 話に出た部屋がある時は、ほかを少し暗くして、その部屋を光らせる
    if (named.size > 0) {
      ctx.fillStyle = 'rgba(20, 12, 4, 0.38)';
      ctx.fillRect(mx, my, mw, mh);
    }
    const glow = 0.62 + 0.2 * Math.sin(time * 6);
    for (const room of shop.rooms) {
      if (!named.has(room.name)) continue;
      ctx.fillStyle = `rgba(255, 214, 64, ${glow})`;
      ctx.fillRect(mx + room.x * unit, my + room.y * unit, room.w * unit, room.h * unit);
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#e67e22';
      ctx.strokeRect(mx + room.x * unit + 2, my + room.y * unit + 2, room.w * unit - 4, room.h * unit - 4);
    }
    // 見つかった所
    const found = segment.info.kind === 'report' ? shop.rooms.find((r) => r.name === segment.info.room) : undefined;
    if (found) {
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 5]);
      ctx.strokeRect(mx + found.x * unit + 1.5, my + found.y * unit + 1.5, found.w * unit - 3, found.h * unit - 3);
      ctx.setLineDash([]);
    }
    for (const room of shop.rooms) {
      const hot = named.has(room.name);
      const size = hot ? 20 : Math.min(14, Math.max(10, (room.w * unit - 4) / [...room.name].length));
      drawText(ctx, room.name, mx + (room.x + room.w / 2) * unit, my + (room.y + room.h / 2) * unit, { size, align: 'center', weight: 900, color: hot ? '#3b2a1e' : 'rgba(59, 42, 30, 0.6)', stroke: hot ? 'rgba(255,255,255,0.85)' : undefined, strokeWidth: hot ? 4 : undefined });
    }
    if (found) {
      const fx = mx + (found.x + found.w / 2) * unit;
      const fy = my + found.y * unit + 4;
      roundRect(ctx, fx - 52, fy, 104, 24, 12);
      ctx.fillStyle = '#c0392b';
      ctx.fill();
      drawText(ctx, '見つかった所', fx, fy + 13, { size: 15, weight: 800, color: '#fff', align: 'center' });
    }
    ctx.restore();
  }

  /** ずんだ餅になった人の顔の並びの上のふち（仕込みの札の下。開店の時計がある記録では、その下）。 */
  private mochiFacesTop(): number {
    return MEETING_HEAD.y + (this.show.log.roam?.config.deadline !== 0 ? 200 : 154) + MOCHI_FACE.gap;
  }

  /** その集会の時点で、ずんだ餅になっている人（餅になった順。占われた狐も入る。クビになった人は入らない）。 */
  private mochiFaces(segment: MeetingSegment): Member[] {
    const asleep = new Set(segment.info.absent.filter((a) => a.status === 'asleep').map((a) => a.name));
    const order: string[] = [];
    for (const event of this.show.log.events) {
      if ('t' in event && typeof event.t === 'number' && event.t > segment.info.t) break;
      const target = event.type === 'nap' || (event.type === 'divine' && event.cursed) ? event.target : null;
      if (target && asleep.has(target) && !order.includes(target)) order.push(target);
    }
    // 記録に出来事の無い人（前の仕様の記録など）は、席の順で後ろに足す
    for (const name of asleep) if (!order.includes(name)) order.push(name);
    return order.flatMap((name) => {
      const member = this.byName.get(name);
      return member ? [member] : [];
    });
  }

  private drawMochiFaces(ctx: Ctx, segment: MeetingSegment, x: number, top: number, width: number, time: number): void {
    const faces = this.mochiFaces(segment);
    if (faces.length === 0) return;
    const r = MOCHI_FACE.r;
    const step = Math.min(r * 2 + 10, (width - r * 2) / Math.max(1, faces.length - 1));
    faces.forEach((member, i) => {
      const cx = x + r + 2 + i * step;
      const cy = top + r;
      drawPortrait(ctx, cx, cy, r, { ...this.look(member, time), mood: 'normal' });
      // ずんだ餅になった印: 顔のふちを、ずんだの緑でなぞる
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r + 2.5, 0, Math.PI * 2);
      ctx.lineWidth = 4;
      ctx.strokeStyle = MOCHI_INK;
      ctx.stroke();
      ctx.restore();
    });
  }

  private drawAbsent(ctx: Ctx, segment: MeetingSegment, time: number): void {
    const { absent } = segment.info;
    plaque(ctx, 1508, 26, 376, 92, { radius: 20, fill: PAPER_DARK });
    if (absent.length === 0) {
      drawText(ctx, '全員が出席', 1696, 74, { size: 28, align: 'center', color: '#5e4a36', weight: 700 });
      return;
    }
    drawText(ctx, '来ていない人', 1530, 50, { size: 20, color: '#5e4a36', weight: 700 });
    const step = absent.length <= 2 ? 170 : Math.min(84, 330 / absent.length);
    absent.forEach((entry, i) => {
      const member = this.byName.get(entry.name);
      if (!member) return;
      const x = 1552 + i * step;
      drawPortrait(ctx, x, 88, 22, { ...this.look(member, time), asleep: entry.status === 'asleep', dim: entry.status !== 'asleep' });
      if (absent.length <= 2) drawText(ctx, member.name, x + 30, 90, { size: 22, color: entry.status === 'asleep' ? MOCHI_INK : '#8d877a', weight: 800 });
    });
  }

  private drawSpeech(ctx: Ctx, cue: Cue, speak: EventOf<'speak'>, speaker: Seat, seats: Seat[], time: number, options: RenderOptions): void {
    const local = time - cue.at;
    const length = cue.end - cue.at;
    const { member } = speaker;

    // 内心と、疑っている相手（観戦者にだけ見える）
    if (options.secrets) {
      const thought = plainThought(speak.thought);
      const fit = fitText(ctx, thought, THOUGHT_FRAMES, 600);
      const size = fit.frame.size;
      const lead = Math.round(size * 1.375);
      const cw = THOUGHT_W;
      const ch = 66 + fit.rows.length * lead;
      const cx = W / 2;
      const cy = MEETING_MAP.y + 2;
      const suspect = seats.find((s) => s.member.name === speak.suspect);
      const show = clamp01((local - 0.5) / 0.3);
      if (suspect && suspect.member !== member && show > 0) {
        const fromX = speaker.x;
        const toX = suspect.x;
        const fromY = speaker.y - 226;
        const toY = suspect.y - 196;
        // 「あやしい」の札（弧のいちばん高い所）が、真上にあるもの（左の札・内心の雲と小さな丸・右の地図）より下に来るようにする。
        // 札の中心は (fromY + 2·top + toY − 26) / 4 なので、札の上のふち（中心 − 22）が floor + 6 になる top を求める。
        // ただし、弧が話す人の頭より下へたるまないよう、両端より少し上までにとどめる
        const midX = (fromX + toX) / 2;
        const above = [
          ...(this.shop ? [{ x0: MEETING_MAP.x, x1: MEETING_MAP.x + MEETING_MAP.w, bottom: MEETING_MAP.y + MEETING_MAP.h }] : []),
          ...(thought ? [{ x0: cx - cw / 2, x1: cx + cw / 2, bottom: cy + ch + 44 }] : []),
          { x0: MEETING_HEAD.x, x1: MEETING_HEAD.x + MEETING_HEAD.w, bottom: this.meetingHeadBottom },
        ];
        const floor = Math.max(0, ...above.filter((r) => midX + 62 > r.x0 && midX - 62 < r.x1).map((r) => r.bottom));
        const natural = Math.min(fromY, toY) - 60 - Math.abs(toX - fromX) * 0.1;
        const top = Math.min(Math.max(natural, (4 * (floor + 28) - fromY - toY + 26) / 2), Math.min(fromY, toY) - 10);
        ctx.save();
        ctx.globalAlpha = show * 0.95;
        ctx.setLineDash([16, 12]);
        ctx.lineDashOffset = -time * 40;
        ctx.lineWidth = 7;
        ctx.strokeStyle = '#c0392b';
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.quadraticCurveTo((fromX + toX) / 2, top, toX, toY - 26);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.moveTo(toX, toY);
        ctx.lineTo(toX - 17, toY - 32);
        ctx.lineTo(toX + 17, toY - 32);
        ctx.closePath();
        ctx.fillStyle = '#c0392b';
        ctx.fill();
        const mid = { x: (fromX + toX) / 2, y: (fromY + top * 2 + toY - 26) / 4 };
        roundRect(ctx, mid.x - 62, mid.y - 22, 124, 44, 22);
        ctx.fill();
        drawText(ctx, 'あやしい', mid.x, mid.y + 1, { size: 24, color: '#fff', align: 'center', weight: 800 });
        ctx.restore();
      }
      // 内心の雲（場所は動かさず、話す人が変わるたびに、さっと出す）
      const cloud = clamp01((local - 0.1) / 0.25);
      if (thought && cloud > 0) {
        const left = cx - cw / 2;
        ctx.save();
        ctx.globalAlpha = cloud;
        ctx.fillStyle = 'rgba(46, 38, 66, 0.9)';
        roundRect(ctx, left, cy, cw, ch, 26);
        ctx.fill();
        // 雲の下の小さな丸は、話している人の側へ寄せる（左の札・右の地図にはかからない）
        const anchor = Math.min(left + cw - 60, Math.max(left + 60, speaker.x));
        for (const [i, r] of [11, 7].entries()) {
          ctx.beginPath();
          ctx.arc(Math.min(left + cw - 20, Math.max(left + 20, lerp(anchor, speaker.x, 0.12 + i * 0.1))), cy + ch + 16 + i * 20, r, 0, Math.PI * 2);
          ctx.fill();
        }
        // 見出し: 話している人の色の名札 ＋「の内心」（雲が話す人の上に無いので、誰の心かを色でも見せる）
        setFont(ctx, 24, 800);
        const nw = ctx.measureText(member.name).width + 30;
        roundRect(ctx, left + 22, cy + 14, nw, 36, 18);
        ctx.fillStyle = member.color.main;
        ctx.fill();
        drawText(ctx, member.name, left + 22 + nw / 2, cy + 33, { size: 24, color: '#fff', align: 'center', weight: 800, stroke: member.color.dark, strokeWidth: 4 });
        drawText(ctx, 'の内心', left + 32 + nw, cy + 33, { size: 22, color: '#c9bdf0', weight: 800 });
        fit.rows.forEach((line, n) => drawText(ctx, line, left + 28, cy + 58 + lead / 2 + n * lead, { size, color: '#fff', weight: 600 }));
        ctx.restore();
      }
    }

    // 字幕（話している言葉）。1文字ずつ出す。立ち絵がある人は、左に胸から上の立ち絵を出し、字幕はその右に
    const portrait = hasPortrait(member.name);
    const bx = portrait ? 480 : 150;
    // 地図は上にあるので、字幕は右のふちの手前まで使う
    const bw = W - 150 - bx;
    const by = 812;
    const bh = 222;
    const enter = easeOut(local / 0.22);
    ctx.save();
    ctx.globalAlpha = Math.min(enter, clamp01((length - local) / 0.2 + 0.4));
    ctx.translate(0, (1 - enter) * 20);
    if (portrait) {
      // 枠の上へ頭が少し出るように、横と下だけを枠で切る
      const fx = 140;
      const fw = 320;
      const fy = 722;
      const fb = 1042;
      plaque(ctx, fx, fy, fw, fb - fy, { radius: 30, fill: member.color.light, edge: member.color.dark });
      const talk = cue.clip?.mouth ? mouthAt(cue.clip.mouth, local) : local < length * 0.82 ? 0.25 + 0.75 * Math.abs(Math.sin(local * 13 + Math.sin(local * 5) * 2)) : 0;
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(fx + 3, 540);
      ctx.lineTo(fx + fw - 3, 540);
      ctx.lineTo(fx + fw - 3, fb - 30);
      ctx.arcTo(fx + fw - 3, fb - 3, fx + fw - 30, fb - 3, 27);
      ctx.lineTo(fx + 30, fb - 3);
      ctx.arcTo(fx + 3, fb - 3, fx + 3, fb - 30, 27);
      ctx.closePath();
      ctx.clip();
      // 顎を枠の左右の真ん中に置く。頭の大きさと顎の高さは全員そろえる
      drawBust(ctx, member.name, { x: fx + fw / 2, chinY: fb - 123, headSize: 240, y: fb, width: fw, height: 370, talk, face: 'right' });
      ctx.restore();
    }
    plaque(ctx, bx, by, bw, bh, { radius: 30, fill: '#fffdf6', edge: member.color.dark });
    // しっぽ（話している人のほうへ）
    const tail = Math.min(bx + bw - 90, Math.max(bx + 90, speaker.x));
    ctx.beginPath();
    ctx.moveTo(tail - 26, by + 2);
    ctx.lineTo(tail, by - 36);
    ctx.lineTo(tail + 26, by + 2);
    ctx.fillStyle = '#fffdf6';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = member.color.dark;
    ctx.beginPath();
    ctx.moveTo(tail - 26, by);
    ctx.lineTo(tail, by - 36);
    ctx.lineTo(tail + 26, by);
    ctx.stroke();
    // 名前の札
    setFont(ctx, 34, 800);
    const nw = ctx.measureText(member.name).width + 60;
    roundRect(ctx, bx + 40, by - 30, nw, 60, 30);
    ctx.fillStyle = member.color.main;
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = member.color.dark;
    ctx.stroke();
    drawText(ctx, member.name, bx + 40 + nw / 2, by + 2, { size: 34, color: '#fff', align: 'center', weight: 800, stroke: member.color.dark, strokeWidth: 5 });
    drawBrainChip(ctx, bx + 40 + nw + 12, by + 2, member.brainId, 26);

    // 3行に入らなければ、文字を少し小さくする（立ち絵の分だけ、字幕の幅が狭い）
    let size = 46;
    let rows = wrapText(ctx, displayText(speak.say), bw - 110, size, 700);
    if (rows.length > 3) {
      size = 40;
      rows = wrapText(ctx, displayText(speak.say), bw - 110, size, 700);
    }
    const all = clampLines(rows, 3);
    const total = all.reduce((sum, line) => sum + [...line].length, 0);
    // 音声があれば、音声の中の区切り（間）ごとに、そのかたまりを話している間に文字を出す
    const spoken = cue.clip ? cue.clip.seconds * 0.96 : length * 0.78;
    let budget = revealedChars(total, local, cue.clip?.phrases, spoken);
    const top = by + bh / 2 + 16 - ((all.length - 1) * (size + 14)) / 2;
    all.forEach((line, n) => {
      const chars = [...line];
      const shown = chars.slice(0, Math.max(0, budget)).join('');
      budget -= chars.length;
      if (shown) drawText(ctx, shown, bx + 56, top + n * (size + 14), { size, weight: 700 });
    });
    ctx.restore();
  }

  private drawVote(ctx: Ctx, segment: MeetingSegment, seats: Seat[], time: number, options: RenderOptions): void {
    const sinceStart = time - segment.voteStart;
    const sinceReveal = time - segment.revealAt;
    const result = segment.result;
    const sinceResult = result ? time - segment.resultAt : -1;

    // 札（ひとり1枚。合図でいっせいに開く）
    if (sinceResult < 0.3) {
      for (const [i, seat] of seats.entries()) {
        const vote = segment.votes.find((v) => v.voter === seat.member.name);
        const rise = easeBack((sinceStart - i * 0.08) / 0.4);
        if (rise <= 0) continue;
        const flip = clamp01(sinceReveal / 0.45);
        // 誰が誰に入れたかは、投票のあとで全員に明かされる（役職を隠している時も見せる）
        const face = flip > 0.5 && vote !== undefined;
        const squeeze = Math.abs(Math.cos(flip * Math.PI));
        const wobble = sinceReveal < 0 ? Math.sin(time * 6 + i) * 0.05 : 0;
        ctx.save();
        ctx.translate(seat.x, seat.y - 96 - seat.scale * 76 + (1 - rise) * 80);
        ctx.rotate(wobble);
        ctx.scale(Math.max(0.04, squeeze), 1);
        ctx.globalAlpha = clamp01(rise) * clamp01(1 - sinceResult / 0.3);
        const target = vote ? this.byName.get(vote.vote) : undefined;
        // 札は、となりの席と重ならない幅にする
        const cw = Math.min(168, seat.gap - 10);
        const f = cw / 168;
        plaque(ctx, -cw / 2, -52 * f, cw, 104 * f, { radius: 14, fill: face ? (target ? target.color.light : '#eee6d2') : '#fff7e0', edge: face && target ? target.color.dark : WOOD_DARK });
        if (face && vote) {
          drawText(ctx, vote.vote, 0, 2, { size: ([...vote.vote].length > 4 ? 28 : 36) * f, align: 'center', weight: 800, color: target ? target.color.dark : '#6b5134' });
        } else {
          drawText(ctx, flip > 0.5 ? '済' : '？', 0, 2, { size: 54 * f, align: 'center', weight: 900, color: '#b89b6a' });
        }
        ctx.restore();
      }
    }

    // 下: 案内 → 票の数 → 結果
    if (sinceReveal < 0.6 || !result) {
      if (options.bare) return;
      const dots = '・'.repeat(1 + (Math.floor(time * 2.5) % 3));
      plaque(ctx, W / 2 - 520, 846, 1040, 150, { radius: 30, fill: '#fffdf6', edge: '#c0392b' });
      drawText(ctx, sinceReveal < 0 ? `クビにする人を、いっせいに選ぶ${dots}` : '札を開く！', W / 2, 922, { size: 48, align: 'center', weight: 800, color: sinceReveal < 0 ? INK : '#c0392b' });
      return;
    }
    const rows = result.tally;
    const tallyAlpha = options.bare ? 0 : sinceResult < 0 ? clamp01((sinceReveal - 0.6) / 0.3) : clamp01(1 - (sinceResult - 0.1) / 0.3);
    if (tallyAlpha > 0) {
      ctx.save();
      ctx.globalAlpha = tallyAlpha;
      const pw = Math.min(1760, Math.max(900, rows.length * 330));
      plaque(ctx, W / 2 - pw / 2, 822, pw, 206, { radius: 30, fill: '#fffdf6' });
      const colW = (pw - 60) / Math.max(1, rows.length);
      // 票の入った相手が多い時は、ひとり分の幅に合わせて小さくする
      const f = Math.min(1, colW / 300);
      const beat = Math.min(0.22, 2.4 / Math.max(1, rows.reduce((sum, row) => sum + row.count, 0)));
      let shown = 0;
      rows.forEach((row, i) => {
        const cx = W / 2 - pw / 2 + 30 + colW * (i + 0.5);
        const member = this.byName.get(row.target);
        if (member) drawPortrait(ctx, cx - colW / 2 + 20 * f + 34 * f, 884, 34 * f, { ...this.look(member, time) });
        drawText(ctx, row.target, cx - colW / 2 + (member ? 100 : 30) * f, 884, { size: 34 * f, weight: 800, color: member ? member.color.dark : '#6b5134' });
        // 票が多い時は、餅の間をつめて、ひとり分の幅に収める
        const step = Math.min(46 * f, (colW - 156 * f) / Math.max(1, row.count - 1));
        for (let n = 0; n < row.count; n++) {
          const pop = easeBack((sinceReveal - 0.9 - shown * beat) / 0.25);
          shown += 1;
          if (pop > 0) zundaMochi(ctx, cx - colW / 2 + 42 * f + n * step, 966, 19 * f * pop);
        }
        drawText(ctx, `${row.count}票`, cx + colW / 2 - 14 * f, 966, { size: 30 * f, weight: 800, align: 'right', color: '#5e4a36' });
      });
      ctx.restore();
    }
    if (sinceResult >= 0) {
      const pop = easeBack(sinceResult / 0.45);
      const member = result.ejected ? this.byName.get(result.ejected) : undefined;
      if (member && result.ejected) {
        this.drawFired(ctx, member, result, sinceResult, time, options);
        return;
      }
      ctx.save();
      ctx.translate(W / 2, 900);
      ctx.scale(pop, pop);
      plaque(ctx, -640, -110, 1280, 220, { radius: 36, fill: '#fffdf6', edge: member ? member.color.dark : WOOD_DARK });
      if (member && result.ejected) {
        drawPortrait(ctx, -520, 0, 78, { ...this.look(member, time), mood: 'worried' });
        drawText(ctx, `${result.ejected}に`, -410, -38, { size: 50, weight: 800, color: member.color.dark });
        drawText(ctx, 'クビにした', -410, 36, { size: 60, weight: 900 });
        if (result.ejectedRole) {
          // 全員に知らされるのは、妖精だったかどうか（狐は「狐だった」）
          const verdict = ejectVerdict(result.ejectedRole);
          const stamp = easeBack((sinceResult - 1.3) / 0.3);
          if (stamp > 0) {
            ctx.save();
            ctx.translate(430, -12);
            ctx.rotate(-0.1);
            ctx.scale(stamp, stamp);
            const color = verdict.fairy ? ROLE_COLOR.nibbler : verdict.fox ? ROLE_COLOR.fox : '#4f6f3a';
            roundRect(ctx, -180, -62, 360, 124, 22);
            ctx.fillStyle = verdict.fairy ? 'rgba(255, 232, 226, 0.9)' : verdict.fox ? 'rgba(253, 236, 214, 0.9)' : 'rgba(236, 244, 226, 0.9)';
            ctx.fill();
            ctx.lineWidth = 8;
            ctx.strokeStyle = color;
            ctx.stroke();
            drawText(ctx, verdict.fairy ? '妖精' : verdict.fox ? '狐' : '妖精では', 0, -18, { size: verdict.fairy || verdict.fox ? 56 : 50, color, align: 'center', weight: 900 });
            drawText(ctx, verdict.fairy || verdict.fox ? 'だった！' : 'なかった…', 0, 34, { size: 38, color, align: 'center', weight: 800 });
            ctx.restore();
          }
          // 観戦者にだけ: 本当の役職（全員に知らされたことと違う時）。札の下のふちに、付箋のように貼る
          const truth = options.secrets ? ejectTruth(result.ejectedRole, this.madmen.length + this.foxes.length > 0) : null;
          const note = easeOut((sinceResult - 2.1) / 0.35);
          if (truth && note > 0) {
            ctx.save();
            ctx.globalAlpha *= note;
            ctx.translate(430, 108 + (1 - note) * 14);
            setFont(ctx, 28, 800);
            const tw = ctx.measureText(truth).width + 48;
            roundRect(ctx, -tw / 2, -23, tw, 46, 23);
            ctx.fillStyle = ROLE_COLOR[result.ejectedRole];
            ctx.fill();
            ctx.lineWidth = 4;
            ctx.strokeStyle = '#fffdf6';
            ctx.stroke();
            drawText(ctx, truth, 0, 1, { size: 28, color: '#fff', align: 'center', weight: 800 });
            ctx.restore();
          }
        }
      } else {
        drawText(ctx, '誰も クビにならなかった', 0, -26, { size: 60, weight: 900, align: 'center' });
        drawText(ctx, VERDICT_TEXT[result.verdict] ?? '', 0, 50, { size: 36, weight: 700, align: 'center', color: '#7b6248' });
      }
      ctx.restore();
    }
  }

  /**
   * 餅に変わった瞬間、まわりの起きている人に付ける札。見た人は試合の記録（witnesses）のとおり。
   * 見ていない人の理由は、その時の位置・あかり・壁から決める（試合の視界の決まりと同じ: 遠い → 暗い → 壁）。
   * 遠すぎる人（見える距離の 1.6 倍より先）と、床下・心だけの人には付けない。
   */
  private bystanders(cue: Cue, segment: RoamSegment, shop: Workshop, vision: number, dim: number): { seat: number; kind: SightKind }[] {
    const cached = this.sightTags.get(cue);
    if (cached) return cached;
    const event = cue.event as EventOf<'nap'>;
    const poses = posesAt(this.show, segment, cue.at);
    const target = poses[this.byName.get(event.target)?.seat ?? -1];
    const dark = troubleAt(this.show, cue.at)?.what === 'lights';
    const seen = new Map(event.witnesses.map((w) => [w.name, w.sawWho]));
    const tags: { seat: number; kind: SightKind }[] = [];
    for (const member of this.members) {
      const pose = poses[member.seat];
      if (!target || !isUp(pose) || pose.state === 'u' || member.name === event.by || member.name === event.target) continue;
      const far = Math.hypot(pose.x - target.x, pose.y - target.y);
      const sawWho = seen.get(member.name);
      let kind: SightKind | null = null;
      if (sawWho !== undefined) kind = member.role === 'nibbler' ? 'ally' : sawWho ? 'saw' : 'half';
      else if (far > vision * 1.6) kind = null;
      else if (far > vision) kind = 'far';
      else if (dark && member.role !== 'nibbler' && far > vision * dim) kind = 'dark';
      else if (!clearLine(shop, pose, target)) kind = 'wall';
      if (kind) tags.push({ seat: member.seat, kind });
    }
    this.sightTags.set(cue, tags);
    return tags;
  }

  /**
   * クビの場面。「クビのお知らせ」の紙が下りてきて、はんこ「クビ」がどん。本人は風呂敷を背負って、とぼとぼ出ていく。
   * 最後に、全員に知らされること（妖精だったかどうか）の札を紙に押す。観戦者にだけ、本当の役職の付箋も貼る。
   * 時刻は FIRED（はんこの音も同じ時刻で鳴らす）。下の案内役の帯（y 936〜）にはかからないようにする。
   */
  private drawFired(ctx: Ctx, member: Member, result: NonNullable<MeetingSegment['result']>, local: number, time: number, options: RenderOptions): void {
    ctx.save();
    ctx.globalAlpha = clamp01(local / 0.3) * 0.62;
    ctx.fillStyle = '#1b1208';
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // はんこを押した瞬間に、画面ごと少しゆれる
    const sinceStamp = local - FIRED.stamp;
    const shake = sinceStamp > 0 && sinceStamp < 0.3 ? Math.sin(sinceStamp * 90) * 14 * (1 - sinceStamp / 0.3) : 0;
    ctx.save();
    ctx.translate(shake, shake * 0.4);

    // 紙
    const pw = 640;
    const ph = 640;
    const place = options.fired;
    const px = place ? place.paperX : W / 2 + 230;
    const drop = easeBack(local / 0.45);
    const py = (place ? place.paperY : 150) - (1 - drop) * 780;
    ctx.save();
    ctx.translate(px, py + ph / 2);
    ctx.rotate(0.012 + (1 - drop) * 0.05);
    ctx.translate(-px, -(py + ph / 2));
    plaque(ctx, px - pw / 2, py, pw, ph, { radius: 18, fill: '#fffaf0', edge: '#8f251c' });
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c0392b';
    roundRect(ctx, px - pw / 2 + 18, py + 18, pw - 36, ph - 36, 10);
    ctx.stroke();
    drawText(ctx, 'クビのお知らせ', px, py + 92, { size: 60, weight: 900, color: '#8f251c', align: 'center' });
    drawText(ctx, `${member.name}さん`, px, py + 196, { size: 54, weight: 900, color: member.color.dark, align: 'center' });
    setFont(ctx, 54, 900);
    const nw = ctx.measureText(`${member.name}さん`).width;
    ctx.fillStyle = member.color.dark;
    ctx.fillRect(px - nw / 2, py + 228, nw, 4);
    ['本日かぎりで、', 'ずんだ餅工房を', 'クビとします。'].forEach((line, i) => drawText(ctx, line, px - pw / 2 + 70, py + 292 + i * 56, { size: 42, weight: 800, color: INK }));
    drawText(ctx, 'ずんだ餅工房 一同', px + pw / 2 - 52, py + ph - 46, { size: 28, weight: 700, color: '#7b6248', align: 'right' });
    // はんこ「クビ」
    if (sinceStamp > 0) {
      const size = lerp(2.6, 1, easeOut(sinceStamp / 0.16));
      ctx.save();
      ctx.translate(px + 168, py + 372);
      ctx.rotate(-0.2);
      ctx.scale(size, size);
      ctx.globalAlpha = clamp01(sinceStamp / 0.08) * 0.92;
      ctx.strokeStyle = '#d63a2f';
      ctx.lineWidth = 9;
      ctx.beginPath();
      ctx.arc(0, 0, 92, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.arc(0, 0, 77, 0, Math.PI * 2);
      ctx.stroke();
      drawText(ctx, 'クビ', 0, 4, { size: 78, weight: 900, color: '#d63a2f', align: 'center' });
      ctx.restore();
    }
    // 全員に知らされるのは、妖精だったかどうか（狐は「狐だった」）
    if (result.ejectedRole) {
      const verdict = ejectVerdict(result.ejectedRole);
      const stamp = easeBack((local - FIRED.verdict) / 0.3);
      if (stamp > 0) {
        ctx.save();
        ctx.translate(px - 130, py + ph - 118);
        ctx.rotate(-0.08);
        ctx.scale(stamp, stamp);
        const color = verdict.fairy ? ROLE_COLOR.nibbler : verdict.fox ? ROLE_COLOR.fox : '#4f6f3a';
        roundRect(ctx, -170, -58, 340, 116, 22);
        ctx.fillStyle = verdict.fairy ? 'rgba(255, 232, 226, 0.95)' : verdict.fox ? 'rgba(253, 236, 214, 0.95)' : 'rgba(236, 244, 226, 0.95)';
        ctx.fill();
        ctx.lineWidth = 8;
        ctx.strokeStyle = color;
        ctx.stroke();
        drawText(ctx, verdict.fairy ? '妖精' : verdict.fox ? '狐' : '妖精では', 0, -16, { size: verdict.fairy || verdict.fox ? 54 : 48, color, align: 'center', weight: 900 });
        drawText(ctx, verdict.fairy || verdict.fox ? 'だった！' : 'なかった…', 0, 34, { size: 36, color, align: 'center', weight: 800 });
        ctx.restore();
      }
      // 観戦者にだけ: 本当の役職（全員に知らされたことと違う時）
      const truth = options.secrets ? ejectTruth(result.ejectedRole, this.madmen.length + this.foxes.length > 0) : null;
      const note = easeOut((local - FIRED.note) / 0.35);
      if (truth && note > 0) {
        ctx.save();
        ctx.globalAlpha *= note;
        ctx.translate(px - 130, py + ph + 6 + (1 - note) * 14);
        setFont(ctx, 28, 800);
        const tw = ctx.measureText(truth).width + 48;
        roundRect(ctx, -tw / 2, -23, tw, 46, 23);
        ctx.fillStyle = ROLE_COLOR[result.ejectedRole];
        ctx.fill();
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#fffdf6';
        ctx.stroke();
        drawText(ctx, truth, 0, 1, { size: 28, color: '#fff', align: 'center', weight: 800 });
        ctx.restore();
      }
    }
    ctx.restore();

    // 本人: はんこまでは紙の前で立ちつくし、そのあと風呂敷を背負って、左へとぼとぼ出ていく
    const walk = clamp01((local - FIRED.walk) / FIRED.walkSeconds);
    const scale = place ? place.actorScale : 5;
    const x = lerp(place ? place.actorX : W / 2 - 440, -300, easeInOut(walk));
    const y = (place ? place.actorY : 800) - Math.abs(Math.sin(local * 7)) * (walk > 0 && walk < 1 ? 10 : 0);
    const enter = easeBack((local - 0.15) / 0.4);
    if (enter > 0) {
      const facing: 1 | -1 = walk > 0 ? -1 : 1;
      if (walk > 0) {
        // 風呂敷（背中のほう）
        const bx = x + 26 * scale * 0.62;
        const by = y - 22 * scale * 1.45;
        const r = 22 * scale * 0.56;
        ctx.save();
        ctx.fillStyle = '#4f8f3a';
        ctx.beginPath();
        ctx.arc(bx, by, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
        for (const [dx, dy] of [[-0.4, -0.2], [0.2, -0.45], [0.35, 0.25], [-0.15, 0.4], [-0.5, 0.25]] as const) {
          ctx.beginPath();
          ctx.arc(bx + dx * r, by + dy * r, r * 0.09, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = '#3c6e2c';
        ctx.beginPath();
        ctx.ellipse(bx - r * 0.55, by - r * 0.75, r * 0.32, r * 0.18, -0.6, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
      drawActor(ctx, {
        ...this.look(member, time),
        x,
        y,
        scale: scale * enter,
        facing,
        walking: walk > 0 && walk < 1,
        mood: sinceStamp > 0 ? (walk > 0 ? 'worried' : 'shock') : 'worried',
        wings: options.secrets && member.role === 'nibbler',
        tail: options.secrets && member.role === 'fox',
        orb: options.secrets && member.role === 'seer',
      });
      if (walk <= 0 && !place) this.nameTag(ctx, x, y + 52, member, true, false, clamp01(enter));
      else if (walk > 0 && walk < 1) drawText(ctx, 'とぼとぼ…', x + 30, y + 58, { size: 34, weight: 800, color: '#fffaf0', align: 'center', alpha: clamp01(1 - walk * 1.2) });
    }
    ctx.restore();
  }

  // ───────── はじまり ─────────

  private drawIntro(ctx: Ctx, segment: IntroSegment, time: number, options: RenderOptions): void {
    const local = time - segment.start;
    // 夜明け前の空
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#2b2f5e');
    sky.addColorStop(0.62, '#6a5a8c');
    sky.addColorStop(1, '#e6a57a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < 60; i++) {
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(time * 1.3 + i * 1.7));
      ctx.fillStyle = `rgba(255, 250, 220, ${twinkle * 0.85})`;
      ctx.beginPath();
      ctx.arc(rand(i + 40) * W, rand(i + 140) * 460, 1.4 + rand(i + 9) * 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#3a2a1c';
    ctx.fillRect(0, 846, W, H - 846);
    ctx.fillStyle = '#5e4630';
    ctx.fillRect(0, 846, W, 10);

    // 題
    const drop = easeBack(local / 0.6);
    ctx.save();
    ctx.translate(W / 2, 170 + (drop - 1) * 240);
    zundaMochi(ctx, -690, 4, 58);
    drawText(ctx, 'ずんだ餅工房のもちもち事件', 44, 0, { size: 92, align: 'center', weight: 900, color: '#fff7dc', stroke: '#3a2412', strokeWidth: 22 });
    ctx.restore();
    const sub = easeOut((local - 0.7) / 0.5);
    const hasTasks = (this.show.log.roam?.taskTotal ?? 0) > 0;
    if (sub > 0) drawText(ctx, hasTasks ? '夜明け前の工房。ずんだの妖精に気をつけて、仕込みを終えられるか？' : '夜明け前の工房。開店まで、餅を守りきれるか？', W / 2, 286, { size: 40, align: 'center', weight: 700, color: '#fff', stroke: 'rgba(40, 24, 50, 0.8)', strokeWidth: 9, alpha: sub });

    // 登場人物がひとりずつ出てくる（人数が多い時は、2列に並び、間をつめて出てくる）
    const n = this.members.length;
    const places = this.lineup(800);
    const crowded = n > 8;
    const pace = Math.min(0.28, 2.4 / n);
    const reveal = clamp01((local - 4.3) / 0.4);
    this.members.forEach((member, i) => {
      const place = places[i] as { x: number; y: number; size: number };
      const { x, y, size } = place;
      const appear = easeBack((local - 1.2 - i * pace) / 0.45);
      if (appear <= 0) return;
      const culprit = options.secrets && isOutsider(member.role) && reveal > 0;
      if (culprit) {
        const g = ctx.createRadialGradient(x, y - 110, 20, x, y - 110, 300);
        const tone = member.role === 'nibbler' ? '255, 120, 100' : '190, 120, 230';
        g.addColorStop(0, `rgba(${tone}, ${0.55 * reveal})`);
        g.addColorStop(1, `rgba(${tone}, 0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - 300, y - 410, 600, 600);
      }
      const hop = Math.max(0, Math.sin((local - 1.2 - i * pace) * 7)) * 0.12 * clamp01(1.6 - (local - 1.2 - i * pace));
      drawActor(ctx, { ...this.look(member, time), x, y, scale: 3.3 * size * appear, hop, mood: culprit ? 'sly' : 'happy', facing: x < W / 2 ? 1 : -1, wings: culprit && member.role === 'nibbler' });
      this.nameTag(ctx, x, y + 38 * size, member, false, culprit, clamp01(appear), size);
      // 人数が多い時は、人となりの文を省く（頭脳の名前は、名札の下の札に出ている）
      if (crowded) return;
      // 名札・頭脳の札・役職の札（nameTag）の下に、人となりの文
      const chip = Math.max(15, 19 * size);
      const badge = culprit ? Math.max(16, 20 * size) * 1.5 + 4 : 0;
      const below = y + 38 * size + 30 * size * 0.78 + chip * 1.6 + 4 + badge + 18;
      const lines = clampLines(wrapText(ctx, member.persona, 250, 22, 700), 2);
      lines.forEach((line, row) => drawText(ctx, line, x, below + row * 28, { size: 22, align: 'center', weight: 700, color: '#f3e8cf', alpha: clamp01(appear) }));
    });

    // ひとこと（妖精マニアがいる時は、2行にする）
    if (local > 4.3) {
      const pop = easeBack((local - 4.3) / 0.4);
      const fans = this.madmen.length;
      const foxes = this.foxes.length;
      const lines: { text: string; color: string }[] = [];
      const culprits = this.nibblers.map((member) => member.name).join('と') || '？';
      const count = COUNT_WORD[this.nibblers.length] ?? `${this.nibblers.length}人`;
      if (options.secrets) {
        lines.push({ text: `ずんだの妖精は${culprits}${fans + foxes > 0 ? '' : '（みんなには ないしょ）'}`, color: ROLE_COLOR.nibbler });
        if (fans > 0) lines.push({ text: `妖精マニアは${this.madmen.map((member) => member.name).join('と')}${foxes > 0 ? '' : '（みんなには ないしょ）'}`, color: ROLE_COLOR.madman });
        if (foxes > 0) lines.push({ text: `狐は${this.foxes.map((member) => member.name).join('と')}（みんなには ないしょ）`, color: ROLE_COLOR.fox });
        const seers = this.members.filter((member) => member.role === 'seer');
        if (seers.length > 0) lines.push({ text: `占い師は${seers.map((member) => member.name).join('と')}（みんなには ないしょ）`, color: ROLE_COLOR.seer });
      } else {
        lines.push({ text: `この中に${count || 'ひとり'}、ずんだの妖精がまぎれている`, color: ROLE_COLOR.nibbler });
        if (fans > 0) lines.push({ text: `妖精に味方する人間も、${COUNT_WORD[fans] ?? `${fans}人`}いる`, color: ROLE_COLOR.madman });
        if (foxes > 0) lines.push({ text: `勝ちを横取りする狐も、${COUNT_WORD[foxes] ?? `${foxes}人`}いる`, color: ROLE_COLOR.fox });
      }
      const size = lines.length > 2 ? 32 : lines.length > 1 ? 38 : 44;
      const h = lines.length > 2 ? 160 : lines.length > 1 ? 130 : 104;
      ctx.save();
      ctx.translate(W / 2, crowded ? (lines.length > 1 ? 384 : 392) : 420);
      ctx.scale(pop, pop);
      plaque(ctx, -620, -h / 2, 1240, h, { radius: h / 2, fill: '#fffdf6', edge: '#c0392b' });
      lines.forEach((line, n) => drawText(ctx, line.text, 0, 2 + (n - (lines.length - 1) / 2) * 52, { size, align: 'center', weight: 800, color: line.color }));
      ctx.restore();
    }
  }

  // ───────── おしまい ─────────

  private drawEnding(ctx: Ctx, segment: EndingSegment, time: number, options: RenderOptions): void {
    const local = time - segment.start;
    const winner = segment.info.winner;
    const artisans = winner === 'artisan';
    const stolen = winner === 'fox';
    // 空
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    if (artisans) {
      sky.addColorStop(0, '#ffcf8a');
      sky.addColorStop(0.55, '#ffe9b8');
      sky.addColorStop(1, '#f6e2b4');
    } else {
      sky.addColorStop(0, '#2a2552');
      sky.addColorStop(0.6, '#5a3f7a');
      sky.addColorStop(1, '#3a2c4f');
    }
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);
    if (artisans) {
      // 朝日
      const rise = easeOut(local / 2.5);
      const sunY = 620 - rise * 250;
      const glow = ctx.createRadialGradient(W / 2, sunY, 40, W / 2, sunY, 760);
      glow.addColorStop(0, 'rgba(255, 244, 200, 0.95)');
      glow.addColorStop(1, 'rgba(255, 244, 200, 0)');
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, sunY);
      ctx.rotate(time * 0.08);
      ctx.fillStyle = 'rgba(255, 255, 255, 0.16)';
      for (let i = 0; i < 12; i++) {
        ctx.rotate(Math.PI / 6);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(-90, 1300);
        ctx.lineTo(90, 1300);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
    } else {
      // 月と星
      ctx.fillStyle = '#fff6c8';
      ctx.beginPath();
      ctx.arc(1790, 470, 70, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#4b3a72';
      ctx.beginPath();
      ctx.arc(1820, 452, 64, 0, Math.PI * 2);
      ctx.fill();
      for (let i = 0; i < 46; i++) {
        const twinkle = 0.4 + 0.6 * Math.abs(Math.sin(time * 1.4 + i));
        ctx.fillStyle = `rgba(255, 250, 220, ${twinkle * 0.9})`;
        ctx.beginPath();
        ctx.arc(rand(i) * W, rand(i + 99) * 520, 1.5 + rand(i + 7) * 2.4, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // 地面と、のれん
    ctx.fillStyle = artisans ? '#d9b98a' : '#2c2238';
    ctx.fillRect(0, 842, W, H - 842);
    ctx.fillStyle = artisans ? '#b8935f' : '#1f1829';
    ctx.fillRect(0, 842, W, 10);

    // 紙ふぶき（従業員の勝ち）／ふってくる餅（妖精の勝ち）
    for (let i = 0; i < 90; i++) {
      const speed = 0.11 + rand(i + 3) * 0.12;
      const k = (local * speed + rand(i)) % 1;
      const x = rand(i + 11) * W + Math.sin(local * 1.6 + i) * 30;
      const y = -40 + k * (H + 80);
      if (artisans) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(local * (1 + rand(i + 5) * 3) + i);
        ctx.fillStyle = ['#e4572e', '#4aa84f', '#e6bd1f', '#52b4e8', '#8d63c9', '#ffffff'][i % 6] as string;
        ctx.fillRect(-9, -5, 18, 10);
        ctx.restore();
      } else if (i % 5 === 0) {
        zundaMochi(ctx, x, y, 17 + rand(i + 2) * 9);
      }
    }

    // 題
    const drop = easeBack(local / 0.6);
    ctx.save();
    ctx.translate(W / 2, 200 + (drop - 1) * 260);
    const title = artisans ? '従業員たちの勝ち！' : stolen ? '狐の横取り！' : 'ずんだの妖精の勝ち！';
    drawText(ctx, title, 0, 0, { size: 130, align: 'center', weight: 900, color: stolen ? '#ffb347' : artisans ? '#fff' : '#ffe27a', stroke: artisans ? '#b3541e' : '#2a1640', strokeWidth: 26 });
    ctx.restore();
    const whyK = easeOut((local - 0.9) / 0.5);
    if (whyK > 0) {
      ctx.save();
      ctx.globalAlpha = whyK;
      plaque(ctx, W / 2 - 560, 288, 1120, 84, { radius: 42, fill: 'rgba(255, 253, 246, 0.95)' });
      const was = segment.info.stolenFrom === 'artisan' ? '従業員' : 'ずんだの妖精';
      drawText(ctx, stolen ? `${whyText(segment.info.why, this.nibblers.length)}……${was}の勝ち、のはずが` : whyText(segment.info.why, this.nibblers.length), W / 2, 332, { size: stolen ? 34 : 40, align: 'center', weight: 800 });
      ctx.restore();
    }
    // 妖精が勝った時は、妖精マニアも勝ち
    const fanK = easeBack((local - 1.5) / 0.4);
    const fanText = stolen
      ? `狐（${this.foxes.map((member) => member.name).join('・')}）が、最後まで起きていた！`
      : !artisans && this.madmen.length > 0
        ? `妖精マニア（${this.madmen.map((member) => member.name).join('・')}）も勝ち！`
        : null;
    if (fanText && fanK > 0) {
      const text = fanText;
      ctx.save();
      ctx.translate(W / 2, 410);
      ctx.scale(fanK, fanK);
      setFont(ctx, 34, 800);
      const fw = ctx.measureText(text).width + 64;
      roundRect(ctx, -fw / 2, -30, fw, 60, 30);
      ctx.fillStyle = stolen ? ROLE_COLOR.fox : ROLE_COLOR.madman;
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#f3e3ff';
      ctx.stroke();
      drawText(ctx, text, 0, 1, { size: 34, color: '#fff', align: 'center', weight: 800 });
      ctx.restore();
    }

    // 全員が並ぶ。役職は、おしまいで全員ぶん明かす（名札と役職は、前の列の羽に隠れないよう、全員を描いてから重ねる）
    const status = this.statusAt(time);
    const places = this.lineup(760);
    const labels: (() => void)[] = [];
    this.members.forEach((member, i) => {
      const { x, y, size } = places[i] as { x: number; y: number; size: number };
      const state = status.get(member.name);
      const won = SIDE_OF[member.role] === winner;
      const appear = easeBack((local - 1.3 - i * 0.12) / 0.4);
      if (appear <= 0) return;
      const scale = 3.2 * size * appear;
      const hop = won && state === undefined ? Math.abs(Math.sin(local * 4.4 + i)) * 0.16 : 0;
      const reveal = easeBack((local - 2.6 - i * 0.14) / 0.3);
      drawActor(ctx, { ...this.look(member, time), x, y, scale, hop, asleep: state === 'z', mood: won ? 'happy' : 'worried', alpha: state === 'x' ? 0.55 : 1, facing: x < W / 2 ? 1 : -1, wings: member.role === 'nibbler' && reveal > 0, tail: member.role === 'fox' && reveal > 0, orb: member.role === 'seer' && reveal > 0 });
      labels.push(() => {
        this.nameTag(ctx, x, y + 36 * size, member, false, false, 1, size);
        if (reveal > 0) {
          const font = 26 * Math.max(0.8, size);
          ctx.save();
          // 名札と頭脳の札（nameTag）の下に出す
          const chip = Math.max(15, 19 * size);
          ctx.translate(x, y + 36 * size + 30 * size * 0.78 + chip * 1.6 + 4 + font * 0.85);
          ctx.scale(reveal, reveal);
          setFont(ctx, font, 800);
          const label = ROLE_LABEL[member.role];
          const w = ctx.measureText(label).width + font * 1.4;
          roundRect(ctx, -w / 2, -font * 0.85, w, font * 1.7, font * 0.85);
          ctx.fillStyle = ROLE_COLOR[member.role];
          ctx.fill();
          ctx.lineWidth = 3;
          ctx.strokeStyle = '#fff';
          ctx.stroke();
          drawText(ctx, label, 0, 1, { size: font, color: '#fff', align: 'center', weight: 800 });
          ctx.restore();
        }
      });
    });
    for (const label of labels) label();

    // まとめ
    const result = this.show.log.result;
    if (result && local > 3.6) {
      const k = easeOut((local - 3.6) / 0.5);
      const progress = progressAt(this.show, segment.start);
      const tasks = progress ? `　仕込み${progress.done}/${progress.total}` : '';
      drawText(ctx, `見回り${result.rounds}回　集会${result.meetings}回${tasks}　おわった時刻${clockLabel(result.clock)}${this.show.log.roam?.config.deadline === 0 ? '' : `（開店は ${clockLabel(this.show.opening)}）`}`, W / 2, 1012, { size: 28, align: 'center', weight: 700, color: artisans ? '#6b5134' : '#e6dcf2', alpha: k });
    }
    // 声のクレジットは、画面には出さない
  }
}

export type { Segment };
