// マップ。升目（タイル）の並びで表す。座標の単位はタイルで、タイルの中心は (x + 0.5, y + 0.5)。
// GameMap は関数を持たない素のデータにしておく（複製や保存がそのままできるように）。

export interface Point {
  x: number;
  y: number;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 上映画面の絵のための情報（部屋の四角、床の種類、家具）。試合の決まりには使わない。 */
export interface MapDecor {
  rooms: (Rect & { name: string; floor: string; outdoor: boolean })[];
  halls: (Rect & { name: string; vertical: boolean })[];
  doors: Rect[];
  props: (Rect & { kind: string; top?: string })[];
}

/** マップに合わせた決まり（試合の側で上書きできる）。名前は RoamConfig と同じ。 */
export type MapSettings = Record<string, number>;

/** 持ち場。x・y は、仕込みをする時に立つ升目。name は、そこですること。 */
export interface Station {
  id: string;
  name: string;
  room: string;
  x: number;
  y: number;
}

/** 仕込み。common は全員が持つ。long は持ち場をいくつか回る。short は1か所で終わる。 */
export interface DutyDefinition {
  name: string;
  kind: 'common' | 'long' | 'short';
  /** 仕込みの種類（dutyGroups の id）。無いマップでは、long と short の数で配る。 */
  group?: string;
  /**
   * 工程。station が配列なら、人ごとに、その中の1か所をばらばらに選ぶ（同じ仕込みでも、人によって場所がちがう）。
   */
  steps: { station: string | string[]; seconds: number }[];
  /** 人ごとに、steps の中から pick か所をばらばらに選ぶ（並びは steps のまま。配線の修理は、6か所のうち3か所）。無ければ全部。 */
  pick?: number;
}

/** 仕込みの種類と、1人に配る工程のうち、その種類が占める割合。 */
export interface DutyGroup {
  id: string;
  name: string;
  share: number;
}

/** 妨害を直す場所。lights: あかりが消えた時 / crisis: かまどが焚かれすぎた時（全部に同時に人がつく）。 */
export interface FixPoint {
  id: string;
  name: string;
  room: string;
  x: number;
  y: number;
  for: 'lights' | 'crisis';
}

/** 床下の抜け道の出入口。同じ group の出入口どうしがつながっている。 */
export interface Hatch {
  id: string;
  room: string;
  x: number;
  y: number;
  group: string;
}

/** 工房の道具の種類。admin: シフト表（部屋ごとの人数） / vitals: ずんだ餅ボード（全員が起きているか） / cameras: 防犯カメラの画面。 */
export type DeviceKind = 'admin' | 'vitals' | 'cameras';
export const DEVICE_KINDS: readonly DeviceKind[] = ['admin', 'vitals', 'cameras'];

/** 工房の道具。x・y は、使う時に立つ升目（道具は、その升目に面した壁や台にある）。 */
export interface DeviceDefinition {
  name: string;
  room: string;
  x: number;
  y: number;
}

/** 防犯カメラ。name は映している場所の呼び名、x・y はカメラの目の升目（廊下）。wall は、カメラを取り付けた壁の升目（絵のため）。 */
export interface CameraPoint {
  name: string;
  x: number;
  y: number;
  wall?: { x: number; y: number };
}

export interface MapDevices {
  admin?: DeviceDefinition;
  vitals?: DeviceDefinition;
  /** radius は、カメラに映る距離（升）。あいだに壁や閉まった戸があれば映らない。暗くても映る。 */
  cameras?: DeviceDefinition & { radius: number; points: CameraPoint[] };
}

/** content/maps/*.json の形。 */
export interface MapDefinition {
  name: string;
  /** 名前の無い通路（'.'）の呼び名。 */
  corridor: string;
  /** rows の中の文字 → 部屋の名前。 */
  rooms: Record<string, string>;
  /** rows の中の文字 → 名前のある廊下。 */
  halls?: Record<string, string>;
  /** '#' は壁（通れない・見通せない）、'%' は家具（通れないが見通せる）、'.' は通路、それ以外は rooms / halls にある文字。 */
  rows: string[];
  /** 開始位置のタイル [x, y]。 */
  spawn: [number, number][];
  settings?: MapSettings;
  stations?: Station[];
  duties?: DutyDefinition[];
  dutyGroups?: DutyGroup[];
  fixPoints?: FixPoint[];
  hatches?: Hatch[];
  /** 鐘を鳴らす時に立つ升目。 */
  bell?: Point;
  /** 戸口（閉められる所）。 */
  doors?: Rect[];
  /** 戸を閉められる部屋の名前。 */
  closable?: string[];
  /** 工房の道具（シフト表・ずんだ餅ボード・防犯カメラ）。 */
  devices?: MapDevices;
  decor?: MapDecor;
}

export interface GameMap {
  def: MapDefinition;
  width: number;
  height: number;
  /** 行き先にできる場所の名前（部屋、そのあとに名前のある廊下）。 */
  roomNames: string[];
  /** 場所の名前 → その場所のタイル（左上から順）。 */
  roomTiles: Record<string, Point[]>;
  /** 場所の名前 → 隣り合っていて、歩いて移れる場所。 */
  links: Record<string, string[]>;
  /** いちばん離れた場所どうしを歩く時の、おおよその歩数（タイル）。 */
  span: number;
  /** 戸を閉められる部屋 → その部屋の戸口の升目（y * width + x）。 */
  doorTiles: Record<string, number[]>;
  /** いま閉まっている戸口の升目。通れず、見通せない。試合の中で変わるのはここだけ。 */
  closed: number[];
}

const NEIGHBORS = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
] as const;

export function parseMap(def: MapDefinition): GameMap {
  const width = def.rows[0]?.length ?? 0;
  if (width === 0 || def.rows.some((row) => row.length !== width)) throw new Error('マップの行の長さが揃っていません');
  const named = { ...def.rooms, ...def.halls };
  const roomNames = [...Object.values(def.rooms), ...Object.values(def.halls ?? {})];
  const roomTiles: Record<string, Point[]> = Object.fromEntries(roomNames.map((name) => [name, []]));
  def.rows.forEach((row, y) => {
    [...row].forEach((ch, x) => {
      if (ch === '#' || ch === '%' || ch === '.') return;
      const name = named[ch];
      if (!name) throw new Error(`マップに知らない文字があります: ${ch}`);
      (roomTiles[name] as Point[]).push({ x, y });
    });
  });
  const map: GameMap = { def, width, height: def.rows.length, roomNames, roomTiles, links: {}, span: 0, doorTiles: {}, closed: [] };
  for (const [x, y] of def.spawn) {
    if (!isWalkable(map, x, y)) throw new Error(`開始位置が壁か家具の中です: ${x},${y}`);
  }

  // 隣り合う場所（名簿と同じく、全員が知っている間取り）
  const links = new Map<string, Set<string>>();
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < width; x++) {
      if (!isWalkable(map, x, y)) continue;
      const here = areaAt(map, { x, y });
      for (const [dx, dy] of NEIGHBORS) {
        if (!isWalkable(map, x + dx, y + dy)) continue;
        const there = areaAt(map, { x: x + dx, y: y + dy });
        if (there === here) continue;
        if (!links.has(here)) links.set(here, new Set());
        (links.get(here) as Set<string>).add(there);
      }
    }
  }
  const order = [...roomNames, def.corridor];
  for (const name of order) {
    const set = links.get(name);
    if (set) map.links[name] = order.filter((other) => set.has(other));
  }

  // 部屋ごとの戸口: その部屋の升目か、その部屋に隣り合う升目を含む戸口
  for (const room of def.closable ?? []) {
    const tiles: number[] = [];
    for (const door of def.doors ?? []) {
      const cells: Point[] = [];
      for (let y = door.y; y < door.y + door.h; y++) for (let x = door.x; x < door.x + door.w; x++) cells.push({ x, y });
      const touches = cells.some((c) => [[0, 0], ...NEIGHBORS].some(([dx, dy]) => isWalkable(map, c.x + dx, c.y + dy) && areaAt(map, { x: c.x + dx, y: c.y + dy }) === room));
      if (touches) tiles.push(...cells.filter((c) => isWalkable(map, c.x, c.y)).map((c) => c.y * width + c.x));
    }
    if (tiles.length > 0) map.doorTiles[room] = tiles;
  }

  // いちばん離れた場所どうしの歩数（各場所の真ん中あたりのタイルどうしで測る）
  const middles = roomNames.flatMap((name) => {
    const tiles = roomTiles[name] as Point[];
    return tiles.length > 0 ? [tiles[Math.floor(tiles.length / 2)] as Point] : [];
  });
  for (const from of middles) {
    const steps = distancesFrom(map, from);
    for (const to of middles) map.span = Math.max(map.span, steps[to.y * width + to.x] ?? 0);
  }
  return map;
}

export function isWalkable(map: GameMap, tx: number, ty: number): boolean {
  const ch = map.def.rows[ty]?.[tx];
  if (ch === undefined || ch === '#' || ch === '%') return false;
  return map.closed.length === 0 || !map.closed.includes(ty * map.width + tx);
}

/** 見通しをさえぎるのは、壁と閉まった戸（家具ごしには見える）。 */
function blocksSight(map: GameMap, tx: number, ty: number): boolean {
  const ch = map.def.rows[ty]?.[tx];
  if (ch === undefined || ch === '#') return true;
  return map.closed.length > 0 && map.closed.includes(ty * map.width + tx);
}

/** 閉まった戸を無いものとして、道を探す（心だけになって歩く人のため）。 */
export function findRouteThroughDoors(map: GameMap, from: Point, to: Point): Point[] | null {
  const closed = map.closed;
  map.closed = [];
  try {
    return findRoute(map, from, to);
  } finally {
    map.closed = closed;
  }
}

export function tileOf(pos: Point): Point {
  return { x: Math.floor(pos.x), y: Math.floor(pos.y) };
}

export function centerOf(tile: Point): Point {
  return { x: tile.x + 0.5, y: tile.y + 0.5 };
}

/** その位置の場所の名前（部屋か廊下）。 */
export function areaAt(map: GameMap, pos: Point): string {
  const tile = tileOf(pos);
  const ch = map.def.rows[tile.y]?.[tile.x];
  return (ch && (map.def.rooms[ch] ?? map.def.halls?.[ch])) || map.def.corridor;
}

/** あるタイルから、各タイルまでの歩数（届かないタイルは -1）。 */
function distancesFrom(map: GameMap, from: Point): Int32Array {
  const steps = new Int32Array(map.width * map.height).fill(-1);
  if (!isWalkable(map, from.x, from.y)) return steps;
  const queue = [from.y * map.width + from.x];
  steps[queue[0] as number] = 0;
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as number;
    const cx = current % map.width;
    const cy = Math.floor(current / map.width);
    for (const [dx, dy] of NEIGHBORS) {
      if (!isWalkable(map, cx + dx, cy + dy)) continue;
      const next = (cy + dy) * map.width + cx + dx;
      if (steps[next] !== -1) continue;
      steps[next] = (steps[current] as number) + 1;
      queue.push(next);
    }
  }
  return steps;
}

/** 幅優先探索で最短の道を探す。返すのは、出発タイルを除いた、通るタイルの中心の列。道が無ければ null。 */
export function findPath(map: GameMap, fromTile: Point, toTile: Point): Point[] | null {
  if (!isWalkable(map, fromTile.x, fromTile.y) || !isWalkable(map, toTile.x, toTile.y)) return null;
  const key = (p: Point) => p.y * map.width + p.x;
  const goal = key(toTile);
  const start = key(fromTile);
  const cameFrom = new Map<number, number>([[start, -1]]);
  const queue: number[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const current = queue[head] as number;
    if (current === goal) break;
    const cx = current % map.width;
    const cy = Math.floor(current / map.width);
    for (const [dx, dy] of NEIGHBORS) {
      if (!isWalkable(map, cx + dx, cy + dy)) continue;
      const next = (cy + dy) * map.width + cx + dx;
      if (cameFrom.has(next)) continue;
      cameFrom.set(next, current);
      queue.push(next);
    }
  }
  if (!cameFrom.has(goal)) return null;
  const path: Point[] = [];
  for (let k = goal; k !== start; k = cameFrom.get(k) as number) {
    path.push(centerOf({ x: k % map.width, y: Math.floor(k / map.width) }));
  }
  return path.reverse();
}

/** 体の幅（半分）。まっすぐ歩ける線かを確かめる時に、壁や家具の角をかすめないようにする。 */
const BODY = 0.3;

/** a から b へ、まっすぐ歩けるか（途中に壁も家具も無いか）。 */
function clearWalk(map: GameMap, a: Point, b: Point): boolean {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(distance / 0.25));
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const y = a.y + ((b.y - a.y) * i) / steps;
    for (const dx of [-BODY, BODY]) {
      for (const dy of [-BODY, BODY]) {
        if (!isWalkable(map, Math.floor(x + dx), Math.floor(y + dy))) return false;
      }
    }
  }
  return true;
}

/**
 * from から、to のあるタイルの中心までの道。升目に沿った最短の道を探してから、
 * まっすぐ歩ける所は角を飛ばして、斜めにも歩く自然な道にする。返すのは通る点の列（from は含まない）。
 */
export function findRoute(map: GameMap, from: Point, to: Point): Point[] | null {
  const path = findPath(map, tileOf(from), tileOf(to));
  if (!path) return null;
  const points = [from, ...path];
  const route: Point[] = [];
  let i = 0;
  while (i < points.length - 1) {
    // 先の点から順に試し、まっすぐ行けるいちばん遠い点へ進む（遠すぎる点は試さない）
    let j = Math.min(points.length - 1, i + 48);
    while (j > i + 1 && !clearWalk(map, points[i] as Point, points[j] as Point)) j--;
    route.push(points[j] as Point);
    i = j;
  }
  return route;
}

/** 2点のあいだに壁が無いか。線分を細かく刻んで調べる。 */
export function hasLineOfSight(map: GameMap, a: Point, b: Point): boolean {
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  const steps = Math.max(1, Math.ceil(distance / 0.2));
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (blocksSight(map, Math.floor(a.x + (b.x - a.x) * t), Math.floor(a.y + (b.y - a.y) * t))) return false;
  }
  return true;
}
