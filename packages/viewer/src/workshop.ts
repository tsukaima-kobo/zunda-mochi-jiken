// 工房のマップの絵。間取りは content/maps の独自の定義から作り、床・壁・小道具はすべてこの場で描く。
// 動かない部分（床、壁、壁の飾り）は一度だけ描いておく。家具は登場人物と一緒に毎コマ描く（props.ts）。

import type { MapDecor, MapDefinition } from '../../sim/src/index.ts';
import { DEVICE_WIDTH, deviceSpot, drawDeviceBoard, drawWallCamera } from './devices.ts';
import { drawBell, drawSteamer } from './props.ts';
import type { PropBox } from './props.ts';
import { drawText, FONT, INK, lerp, MOCHI, PAPER, rand, roundRect, setFont, WOOD, WOOD_DARK, ZUNDA, ZUNDA_DARK, zundaMochi } from './theme.ts';
import type { Ctx } from './theme.ts';

export { drawBell };

type FloorKind = 'plank' | 'stone' | 'dark' | 'shop' | 'tatami' | 'soil' | 'gravel' | 'ice' | 'earth' | 'mint' | 'plank2';

interface RoomBox {
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  floor: FloorKind;
  outdoor: boolean;
}

export interface Light {
  x: number;
  y: number;
  radius: number;
}

export interface Workshop {
  layer: HTMLCanvasElement;
  /** 見取り図の下絵（1升 = miniTile ピクセル）。 */
  mini: HTMLCanvasElement;
  miniTile: number;
  cols: number;
  rows: number;
  tile: number;
  width: number;
  height: number;
  rooms: RoomBox[];
  props: PropBox[];
  /** 壁ぎわのせいろ（湯気の出る場所）と、明かりの場所（マップの絵の中のピクセル）。 */
  steamers: { x: number; y: number }[];
  lights: Light[];
  /** 見通しをさえぎる升目か（壁と、マップの外）。 */
  wall(tx: number, ty: number): boolean;
}

// 小さいマップ（部屋の四角や床の指定が無い）の時の、床の決め方
const FLOOR_OF: Record<string, FloorKind> = { 蒸し場: 'stone', 倉庫: 'dark', 店先: 'shop', 休憩室: 'tatami' };
const FLOOR_SPARE: FloorKind[] = ['stone', 'dark', 'shop', 'tatami'];
// 部屋の奥の壁の飾り
const WALL_DECOR: Record<string, string> = {
  蒸し場: 'steamers',
  洗い場: 'sieves',
  あんこ場: 'sieves',
  倉庫: 'shelves',
  包み場: 'shelves',
  道具部屋: 'tools',
  餅つき場: 'tools',
  薪小屋: 'tools',
  機械室: 'tools',
  店先: 'shop',
  休憩室: 'tatami',
  帳場: 'tatami',
  座敷: 'tatami',
  氷室: 'sign:氷',
  ずんだ場: 'sign:豆',
};
const DECOR_BY_FLOOR: Partial<Record<FloorKind, string>> = { stone: 'steamers', dark: 'shelves', shop: 'shop', tatami: 'tatami' };
const MINI_COLOR: Record<FloorKind, string> = {
  plank: '#d9b98a',
  stone: '#cfcabd',
  dark: '#b08659',
  shop: '#ecdcb2',
  tatami: '#c9d49b',
  soil: '#a98558',
  gravel: '#d6cfbc',
  ice: '#cfe3ee',
  earth: '#c6a377',
  mint: '#d6e6c0',
  plank2: '#e0c394',
};

/** 部屋の四角や床の指定が無いマップ（小さいマップ）では、升目から割り出す。 */
function decorOf(map: MapDefinition): MapDecor {
  if (map.decor) return map.decor;
  const rooms = Object.entries(map.rooms).map(([key, name], index) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    map.rows.forEach((row, y) => {
      [...row].forEach((ch, x) => {
        if (ch !== key) return;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      });
    });
    return { name, x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, floor: FLOOR_OF[name] ?? (FLOOR_SPARE[index % FLOOR_SPARE.length] as string), outdoor: false };
  });
  return { rooms, halls: [], doors: [], props: [] };
}

export function buildWorkshop(map: MapDefinition, tile: number): Workshop {
  const rows = map.rows.length;
  const cols = map.rows[0]?.length ?? 0;
  const layer = document.createElement('canvas');
  layer.width = cols * tile;
  layer.height = rows * tile;
  const ctx = layer.getContext('2d') as CanvasRenderingContext2D;
  const decor = decorOf(map);
  const u = tile / 72;
  const at = (x: number, y: number) => map.rows[y]?.[x] ?? '#';
  const isWall = (x: number, y: number) => at(x, y) === '#';

  const rooms = decor.rooms.map((room) => ({ ...room, floor: room.floor as FloorKind }));
  const roomByName = new Map(rooms.map((room) => [room.name, room]));
  const roomAround = (x: number, y: number) => rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
  const kindOf = (x: number, y: number): FloorKind => {
    const ch = at(x, y);
    const name = map.rooms[ch];
    if (name) return roomByName.get(name)?.floor ?? 'plank';
    if (ch === '%') return roomAround(x, y)?.floor ?? 'plank';
    return 'plank';
  };
  const outdoorAt = (x: number, y: number) => {
    const name = map.rooms[at(x, y)];
    return (name ? roomByName.get(name) : roomAround(x, y))?.outdoor === true;
  };

  // 床
  ctx.fillStyle = '#2a1c12';
  ctx.fillRect(0, 0, layer.width, layer.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isWall(x, y)) drawFloor(ctx, kindOf(x, y), x, y, tile);
    }
  }
  // 戸口の敷居
  for (const door of decor.doors) {
    ctx.fillStyle = '#8a5a36';
    const across = door.h === 1;
    if (across) ctx.fillRect(door.x * tile, (door.y + 0.42) * tile, door.w * tile, tile * 0.16);
    else ctx.fillRect((door.x + 0.42) * tile, door.y * tile, tile * 0.16, door.h * tile);
    ctx.fillStyle = 'rgba(40, 22, 8, 0.4)';
    if (across) ctx.fillRect(door.x * tile, (door.y + 0.56) * tile, door.w * tile, 2 * u);
    else ctx.fillRect((door.x + 0.56) * tile, door.y * tile, 2 * u, door.h * tile);
  }
  // 仕込みの持ち場（床の足場の印）と、床下の抜け道の揚げ板
  for (const station of map.stations ?? []) drawSpotMat(ctx, (station.x + 0.5) * tile, (station.y + 0.5) * tile, tile);
  for (const hatch of map.hatches ?? []) drawHatch(ctx, (hatch.x + 0.5) * tile, (hatch.y + 0.5) * tile, tile, 0);
  // 廊下の名前（床に書いた文字）
  for (const hall of decor.halls) {
    const size = tile * 0.72;
    const spots = (hall.vertical ? hall.h : hall.w) > 26 ? [0.27, 0.73] : [0.5];
    for (const k of spots) {
      const chars = [...hall.name];
      chars.forEach((ch, i) => {
        const along = (i - (chars.length - 1) / 2) * size * 1.25;
        const x = hall.vertical ? (hall.x + hall.w / 2) * tile : (hall.x + hall.w * k) * tile + along;
        const y = hall.vertical ? (hall.y + hall.h * k) * tile + along : (hall.y + hall.h / 2) * tile;
        drawText(ctx, ch, x, y, { size, color: 'rgba(96, 60, 28, 0.26)', align: 'center', weight: 800 });
      });
    }
  }
  // ちゃぶ台のまわりの座布団（床に置いてあるだけなので、上を歩ける）
  const padColors = ['#c95f5f', '#5f7fc9', '#c9a85f', '#7c5fc9'];
  for (const [index, prop] of decor.props.entries()) {
    if (prop.kind !== 'lowtable') continue;
    for (const [i, [kx, ky]] of ([[0.22, -0.52], [0.78, -0.52], [0.22, 1], [0.78, 1]] as const).entries()) {
      const cy = ky < 0 ? (prop.y + ky) * tile : (prop.y + prop.h + 0.5) * tile;
      drawCushion(ctx, (prop.x + prop.w * kx) * tile, cy, tile * 0.36, padColors[(i + index) % padColors.length] as string);
    }
  }
  // 壁の影（床の上に落ちる）
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isWall(x, y)) continue;
      if (isWall(x, y - 1)) {
        const g = ctx.createLinearGradient(0, y * tile, 0, y * tile + tile * 0.5);
        g.addColorStop(0, 'rgba(40, 22, 8, 0.34)');
        g.addColorStop(1, 'rgba(40, 22, 8, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x * tile, y * tile, tile, tile * 0.5);
      }
      if (isWall(x - 1, y)) {
        const g = ctx.createLinearGradient(x * tile, 0, x * tile + tile * 0.28, 0);
        g.addColorStop(0, 'rgba(40, 22, 8, 0.22)');
        g.addColorStop(1, 'rgba(40, 22, 8, 0)');
        ctx.fillStyle = g;
        ctx.fillRect(x * tile, y * tile, tile * 0.28, tile);
      }
    }
  }
  // 壁（上から見た梁と、手前に見える面。外の庭や畑を囲む壁は、瓦をのせた土塀にする）
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!isWall(x, y)) continue;
      const px = x * tile;
      const py = y * tile;
      ctx.fillStyle = '#5f3d25';
      ctx.fillRect(px, py, tile, tile);
      ctx.fillStyle = 'rgba(255, 220, 170, 0.08)';
      ctx.fillRect(px, py + tile * (0.12 + rand(x * 31 + y * 17) * 0.5), tile, 2 * u);
      if (!isWall(x, y + 1) && y + 1 < rows) {
        const faceTop = py + tile * 0.36;
        const garden = outdoorAt(x, y + 1);
        ctx.fillStyle = garden ? '#e3d6b8' : '#efe3c8';
        ctx.fillRect(px, faceTop, tile, tile * 0.64);
        ctx.fillStyle = garden ? '#cdbd9a' : '#e2d2b0';
        ctx.fillRect(px, py + tile * 0.84, tile, tile * 0.16);
        ctx.fillStyle = garden ? '#4c5563' : WOOD_DARK;
        ctx.fillRect(px, faceTop - 3 * u, tile, (garden ? 9 : 6) * u);
        ctx.fillStyle = WOOD_DARK;
        ctx.fillRect(px, py + tile - 4 * u, tile, 4 * u);
        if (!garden && x % 2 === 0) ctx.fillRect(px, faceTop, 4 * u, tile * 0.64);
      }
    }
  }
  // 部屋の縁取り（部屋ごとに床の色が違うので、輪郭を少し締める）
  ctx.strokeStyle = 'rgba(60, 35, 15, 0.28)';
  ctx.lineWidth = 2 * u;
  for (const room of rooms) ctx.strokeRect(room.x * tile + 1, room.y * tile + 1, room.w * tile - 2, room.h * tile - 2);

  // 壁の飾りと、部屋の名札
  const steamers: Workshop['steamers'] = [];
  const lights: Light[] = [];
  for (const room of rooms) {
    const wallY = room.y - 1; // 部屋の奥の壁
    const base = (wallY + 1) * tile; // 壁の面の下端
    const left = room.x * tile;
    const width = room.w * tile;
    /** 部屋の幅の k0〜k1 の範囲が、とぎれない壁か（戸口や、別の飾りと重ならないか）。 */
    const used: [number, number][] = [];
    const free = (k0: number, k1: number) => {
      const x0 = Math.floor(room.x + room.w * k0);
      const x1 = Math.ceil(room.x + room.w * k1) - 1;
      for (let x = x0; x <= x1; x++) if (!isWall(x, wallY) || isWall(x, wallY + 1)) return false;
      return !used.some(([a, b]) => k0 < b && k1 > a);
    };

    // 工房の道具（見取り図の盤・名札かけ・防犯カメラの画面）は、道具の升目のすぐ奥の壁にかける。名札や飾りは、よけて置く
    for (const kind of ['admin', 'vitals', 'cameras'] as const) {
      const spot = deviceSpot(map.devices, kind, tile);
      if (!spot || spot.wallY !== wallY || spot.x < room.x || spot.x >= room.x + room.w) continue;
      const half = DEVICE_WIDTH[kind] / 2 / room.w;
      const k = (spot.cx / tile - room.x) / room.w;
      used.push([k - half - 0.02, k + half + 0.02]);
      drawDeviceBoard(ctx, kind, spot.cx, base, tile);
    }

    // 名札は、真ん中に戸口がある時は横へずらす
    const plateW = Math.max(tile * 1.7, [...room.name].length * tile * 0.42 + 26 * u);
    const half = plateW / width / 2 + 0.01;
    const plateAt = [0.5, 0.3, 0.7, 0.2, 0.8].find((k) => free(k - half, k + half));
    if (plateAt !== undefined) {
      drawNameplate(ctx, left + width * plateAt, base - tile * 0.34, room.name, tile);
      used.push([plateAt - half - 0.02, plateAt + half + 0.02]);
    }

    const style = WALL_DECOR[room.name] ?? (map.decor ? '' : (DECOR_BY_FLOOR[room.floor] ?? ''));
    const zones = ([[0.04, 0.3], [0.7, 0.96]] as const).filter(([a, b]) => free(a, b));
    for (const [a, b] of zones) {
      const zoneW = Math.min(width * (b - a), tile * 4);
      const mid = left + (width * (a + b)) / 2;
      const isLeft = a < 0.5;
      if (style === 'steamers') {
        for (const dx of [-0.6, 0.6]) {
          drawSteamer(ctx, mid + dx * tile, base - 3 * u, tile * 0.3, dx > 0 ? 3 : 2);
          steamers.push({ x: mid + dx * tile, y: base - tile * 0.62 });
        }
      } else if (style === 'shelves') {
        drawShelf(ctx, mid - zoneW / 2, base - 3 * u, zoneW, tile * 0.56, isLeft ? 1 : 2);
      } else if (style === 'shop') {
        if (isLeft) drawNoren(ctx, mid - zoneW / 2, base - tile * 0.6, zoneW, tile * 0.56);
        else drawTray(ctx, mid, base - 5 * u, tile * 0.5);
      } else if (style === 'tatami') {
        if (isLeft) drawShoji(ctx, mid - zoneW / 2, base - tile * 0.58, zoneW, tile * 0.5);
        else drawScroll(ctx, mid, base - tile * 0.6, tile * 0.34, tile * 0.56, '餅');
      } else if (style === 'sieves') {
        for (const dx of [-0.8, 0, 0.8]) drawSieve(ctx, mid + dx * tile, base - tile * 0.32, tile * 0.24);
      } else if (style === 'tools') {
        drawWallTools(ctx, mid, base - tile * 0.06, tile, isLeft);
      } else if (style.startsWith('sign:')) {
        drawScroll(ctx, mid, base - tile * 0.6, tile * 0.34, tile * 0.56, style.slice(5));
      }
    }
    // 小さいマップの畳の部屋には、座布団を置く
    if (!map.decor && room.floor === 'tatami') {
      const cx = (room.x + room.w / 2) * tile;
      const cy = (room.y + room.h / 2) * tile + tile * 0.2;
      const pads = [[-1.5, -0.6, '#c95f5f'], [1.5, -0.6, '#5f7fc9'], [-1.5, 0.9, '#c9a85f'], [1.5, 0.9, '#7c5fc9']] as const;
      for (const [dx, dy, fill] of pads) drawCushion(ctx, cx + dx * tile, cy + dy * tile, tile * 0.36, fill);
    }
  }

  // 廊下の提灯: 奥の壁に3升おき。縦の廊下は、左の壁に4升おき
  const isHall = (x: number, y: number) => !isWall(x, y) && at(x, y) !== '%' && !map.rooms[at(x, y)];
  for (let y = 0; y < rows - 1; y++) {
    for (let x = 0; x < cols; x++) {
      if (isWall(x, y) && isHall(x, y + 1) && y > 0 && x % 3 === 1) {
        const lx = x * tile + tile / 2;
        const ly = y * tile + tile * 0.66;
        drawLantern(ctx, lx, ly, tile * 0.2);
        lights.push({ x: lx, y: ly, radius: tile * 1.9 });
      } else if (isHall(x, y) && isWall(x - 1, y) && isWall(x - 1, y - 1) && y % 4 === 2 && !isWall(x, y - 1)) {
        const lx = x * tile + tile * 0.2;
        const ly = y * tile + tile * 0.3;
        drawLantern(ctx, lx, ly, tile * 0.16);
        lights.push({ x: lx, y: ly, radius: tile * 1.7 });
      }
    }
  }
  // 廊下の防犯カメラ
  for (const camera of map.devices?.cameras?.points ?? []) drawWallCamera(ctx, camera, tile);
  // 小さいマップ: いちばん奥の通路の壁の真ん中に鐘（広いマップでは、中庭の鐘つき堂が家具として置いてある）
  if (!map.decor) {
    const topCorridor: number[] = [];
    for (let x = 0; x < cols; x++) if (isWall(x, 0) && isHall(x, 1)) topCorridor.push(x);
    if (topCorridor.length > 0) {
      const cx = (((topCorridor[0] as number) + (topCorridor.at(-1) as number) + 1) / 2) * tile;
      drawBell(ctx, cx, tile * 0.66, tile * 0.3, 0);
    }
  }
  // 火や灯りのある家具のまわりは明るい
  for (const prop of decor.props) {
    const cx = (prop.x + prop.w / 2) * tile;
    const cy = (prop.y + prop.h / 2) * tile;
    if (prop.kind === 'stove') lights.push({ x: cx, y: cy + tile * 0.6, radius: tile * 3 });
    else if (prop.kind === 'pots') lights.push({ x: cx, y: cy + tile * 0.4, radius: tile * 2.2 });
    else if (prop.kind === 'stonelamp') lights.push({ x: cx, y: cy - tile * 0.5, radius: tile * 2.4 });
  }

  // 見取り図の下絵
  const miniTile = Math.max(2, Math.floor(432 / cols));
  const mini = document.createElement('canvas');
  mini.width = cols * miniTile;
  mini.height = rows * miniTile;
  const m = mini.getContext('2d') as CanvasRenderingContext2D;
  m.fillStyle = '#3a2516';
  m.fillRect(0, 0, mini.width, mini.height);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (isWall(x, y)) continue;
      m.fillStyle = MINI_COLOR[kindOf(x, y)];
      m.fillRect(x * miniTile, y * miniTile, miniTile, miniTile);
      if (at(x, y) === '%') {
        m.fillStyle = 'rgba(70, 42, 18, 0.4)';
        m.fillRect(x * miniTile, y * miniTile, miniTile, miniTile);
      }
    }
  }

  return { layer, mini, miniTile, cols, rows, tile, width: layer.width, height: layer.height, rooms, props: decor.props, steamers, lights, wall: isWall };
}

/** 仕込みの持ち場の印（わらで編んだ丸い敷物）。 */
function drawSpotMat(ctx: Ctx, cx: number, cy: number, tile: number): void {
  const u = tile / 72;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy + tile * 0.08, tile * 0.38, tile * 0.3, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(214, 190, 120, 0.55)';
  ctx.fill();
  ctx.lineWidth = 2 * u;
  ctx.strokeStyle = 'rgba(120, 92, 40, 0.55)';
  ctx.stroke();
  for (const k of [0.66, 0.36]) {
    ctx.beginPath();
    ctx.ellipse(cx, cy + tile * 0.08, tile * 0.38 * k, tile * 0.3 * k, 0, 0, Math.PI * 2);
    ctx.lineWidth = 1.4 * u;
    ctx.strokeStyle = 'rgba(120, 92, 40, 0.3)';
    ctx.stroke();
  }
  ctx.restore();
}

/** 床下の抜け道の出入口（床の揚げ板）。open は開き具合（0: 閉じている 〜 1: 開いている）。 */
export function drawHatch(ctx: Ctx, cx: number, cy: number, tile: number, open: number): void {
  const u = tile / 72;
  const s = tile * 0.37;
  const k = Math.min(1, Math.max(0, open));
  ctx.save();
  ctx.lineJoin = 'round';
  // 枠
  roundRect(ctx, cx - s - 4 * u, cy - s - 4 * u, (s + 4 * u) * 2, (s + 4 * u) * 2, 6 * u);
  ctx.fillStyle = '#4a2f1a';
  ctx.fill();
  // 穴（開いている時だけ見える）
  const hole = ctx.createLinearGradient(0, cy - s, 0, cy + s);
  hole.addColorStop(0, '#0d0805');
  hole.addColorStop(1, '#2a1a10');
  ctx.fillStyle = hole;
  ctx.fillRect(cx - s, cy - s, s * 2, s * 2);
  // ふた: 奥の辺を軸に、立ち上がる
  const lidH = s * 2 * (1 - k);
  if (lidH > 1) {
    ctx.fillStyle = '#b98b55';
    ctx.fillRect(cx - s, cy - s, s * 2, lidH);
    ctx.strokeStyle = 'rgba(70, 42, 18, 0.55)';
    ctx.lineWidth = 1.6 * u;
    for (const px of [-0.34, 0.34]) {
      ctx.beginPath();
      ctx.moveTo(cx + px * s * 2 * 0.5 * 1.0, cy - s);
      ctx.lineTo(cx + px * s * 2 * 0.5 * 1.0, cy - s + lidH);
      ctx.stroke();
    }
    // 横木
    ctx.fillStyle = '#7a5230';
    for (const py of [0.2, 0.72]) ctx.fillRect(cx - s, cy - s + lidH * py, s * 2, lidH * 0.1);
    // 鉄の引き手
    ctx.beginPath();
    ctx.ellipse(cx, cy - s + lidH * 0.5, 6 * u, 6 * u * (1 - k), 0, 0, Math.PI * 2);
    ctx.lineWidth = 3 * u;
    ctx.strokeStyle = '#2c2420';
    ctx.stroke();
  }
  if (k > 0.05) {
    // 立ち上がったふたの裏
    const up = s * 1.5 * k;
    ctx.fillStyle = '#8f6a3f';
    ctx.fillRect(cx - s, cy - s - up, s * 2, up);
    ctx.fillStyle = '#6e4d2a';
    ctx.fillRect(cx - s, cy - s - up, s * 2, 4 * u);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2 * u;
    ctx.strokeRect(cx - s, cy - s - up, s * 2, up);
  }
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.2 * u;
  roundRect(ctx, cx - s - 4 * u, cy - s - 4 * u, (s + 4 * u) * 2, (s + 4 * u) * 2, 6 * u);
  ctx.stroke();
  ctx.restore();
}

/** 閉まった戸（板戸）。戸口の四角（升目）に、両側からすべって閉まる。k は閉まり具合（0〜1）。 */
export function drawShutDoor(ctx: Ctx, door: { x: number; y: number; w: number; h: number }, tile: number, k: number): void {
  const u = tile / 72;
  const shut = Math.min(1, Math.max(0, k));
  if (shut <= 0) return;
  const px = door.x * tile;
  const py = door.y * tile;
  const pw = door.w * tile;
  const ph = door.h * tile;
  ctx.save();
  ctx.lineJoin = 'round';
  const board = (x: number, y: number, w: number, h: number, upright: boolean) => {
    if (w < 1 || h < 1) return;
    ctx.fillStyle = '#a9743f';
    ctx.fillRect(x, y, w, h);
    // 板の目と、桟
    ctx.fillStyle = 'rgba(70, 40, 16, 0.4)';
    if (upright) {
      for (let lx = x + 12 * u; lx < x + w - 2; lx += 14 * u) ctx.fillRect(lx, y, 1.6 * u, h);
      ctx.fillStyle = '#6e4526';
      for (const ky of [0.2, 0.74]) ctx.fillRect(x, y + h * ky, w, 5 * u);
    } else {
      for (let ly = y + 12 * u; ly < y + h - 2; ly += 14 * u) ctx.fillRect(x, ly, w, 1.6 * u);
      ctx.fillStyle = '#6e4526';
      for (const kx of [0.2, 0.74]) ctx.fillRect(x + w * kx, y, 5 * u, h);
    }
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6 * u;
    ctx.strokeRect(x, y, w, h);
  };
  if (door.h === 1) {
    // 横に長い戸口（上下に通る）: 上から見た梁と、手前の面に2枚の板戸
    ctx.fillStyle = '#5f3d25';
    ctx.fillRect(px, py, pw * 0.5 * shut, tile * 0.36);
    ctx.fillRect(px + pw - pw * 0.5 * shut, py, pw * 0.5 * shut, tile * 0.36);
    const half = (pw / 2) * shut;
    board(px, py + tile * 0.3, half, tile * 0.7, true);
    board(px + pw - half, py + tile * 0.3, half, tile * 0.7, true);
  } else {
    // 縦に長い戸口（左右に通る）: 上から見た板戸が、奥と手前からすべってくる
    const half = (ph / 2) * shut;
    board(px + tile * 0.18, py, tile * 0.64, half, false);
    board(px + tile * 0.18, py + ph - half, tile * 0.64, half, false);
  }
  // かんぬき（閉まりきったら出る）
  if (shut > 0.98) {
    const cx = px + pw / 2;
    const cy = door.h === 1 ? py + tile * 0.66 : py + ph / 2;
    ctx.fillStyle = '#3a2412';
    if (door.h === 1) ctx.fillRect(cx - tile * 0.34, cy - 5 * u, tile * 0.68, 10 * u);
    else ctx.fillRect(cx - 5 * u, cy - tile * 0.34, 10 * u, tile * 0.68);
    ctx.beginPath();
    ctx.arc(cx, cy, 8 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#c0392b';
    ctx.fill();
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.2 * u;
    ctx.stroke();
  }
  ctx.restore();
}

/** 壁に当たった所から、壁の中へどれだけ明るくするか（升目）。壁の手前の面まで見えている感じにする。 */
const WALL_DEPTH = 0.5;

/** (x, y) から (dx, dy) の向きへ進み、壁に当たる点（または見える距離の端）を返す。升目の境目を順にたどるので、壁ぞいの縁がまっすぐになる。 */
function castSight(shop: Workshop, x: number, y: number, dx: number, dy: number, radius: number, out: number[], faces: number[]): void {
  let tx = Math.floor(x);
  let ty = Math.floor(y);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const perX = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const perY = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let nextX = dx > 0 ? (tx + 1 - x) * perX : dx < 0 ? (x - tx) * perX : Infinity;
  let nextY = dy > 0 ? (ty + 1 - y) * perY : dy < 0 ? (y - ty) * perY : Infinity;
  for (;;) {
    const sideways = nextX < nextY;
    const d = sideways ? nextX : nextY;
    if (d >= radius) {
      out.push(x + dx * radius, y + dy * radius);
      faces.push(0);
      return;
    }
    if (sideways) {
      nextX += perX;
      tx += stepX;
    } else {
      nextY += perY;
      ty += stepY;
    }
    if (shop.wall(tx, ty)) {
      // 壁の中へ少し入れた点。見える距離の円からは、はみ出さないようにする
      const px = dx * d + (sideways ? stepX * WALL_DEPTH : 0);
      const py = dy * d + (sideways ? 0 : stepY * WALL_DEPTH);
      const shrink = Math.min(1, radius / Math.hypot(px, py));
      out.push(x + px * shrink, y + py * shrink);
      faces.push(sideways ? 1 : 2); // 1: 左右を向いた壁の面 / 2: 上下を向いた壁の面
      return;
    }
  }
}

/**
 * (x, y) にいる人から見えている範囲の形（升目の座標を x, y の順に並べたもの）。
 * 等間隔の向きに加えて、壁の角のすぐ手前とすぐ先の向きも調べるので、角のところで縁が欠けない。
 */
export function sightPolygon(shop: Workshop, x: number, y: number, radius: number, rays = 180): number[] {
  const angles: number[] = [];
  for (let i = 0; i < rays; i++) angles.push((i / rays) * Math.PI * 2 - Math.PI);
  const wall = (tx: number, ty: number) => (shop.wall(tx, ty) ? 1 : 0);
  for (let cy = Math.floor(y - radius); cy <= Math.ceil(y + radius); cy++) {
    for (let cx = Math.floor(x - radius); cx <= Math.ceil(x + radius); cx++) {
      if (Math.hypot(cx - x, cy - y) > radius + 0.5) continue;
      // 升目の角 (cx, cy) のまわりの4升
      const a = wall(cx - 1, cy - 1);
      const b = wall(cx, cy - 1);
      const c = wall(cx - 1, cy);
      const d = wall(cx, cy);
      const n = a + b + c + d;
      if (n === 0 || n === 4 || (n === 2 && (a === b || a === c))) continue; // 壁の角ではない（何も無い、壁の中、まっすぐな壁）
      const angle = Math.atan2(cy - y, cx - x);
      angles.push(angle - 0.0008, angle + 0.0008);
    }
  }
  angles.sort((p, q) => p - q);
  const hits: number[] = [];
  const faces: number[] = [];
  for (const angle of angles) castSight(shop, x, y, Math.cos(angle), Math.sin(angle), radius, hits, faces);
  // 壁の角では、左右の面と上下の面の当たった点のあいだに、角の点を足す（縁が斜めに欠けないように）
  const out: number[] = [];
  const count = faces.length;
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    const ax = hits[i * 2] as number;
    const ay = hits[i * 2 + 1] as number;
    out.push(ax, ay);
    const fa = faces[i] as number;
    const fb = faces[j] as number;
    if (fa === 0 || fb === 0 || fa === fb) continue;
    const bx = hits[j * 2] as number;
    const by = hits[j * 2 + 1] as number;
    if (Math.hypot(ax - bx, ay - by) > 1) continue;
    out.push(fa === 1 ? ax : bx, fa === 1 ? by : ay);
  }
  return out;
}

function drawFloor(ctx: Ctx, kind: FloorKind, x: number, y: number, tile: number): void {
  const px = x * tile;
  const py = y * tile;
  const noise = rand(x * 13 + y * 57);
  const u = tile / 72;
  if (kind === 'plank') {
    ctx.fillStyle = noise > 0.5 ? '#dcbb8b' : '#d6b482';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(110, 70, 30, 0.22)';
    ctx.fillRect(px, py, tile, 1.5 * u);
    ctx.fillRect(px, py + tile / 2, tile, 1.5 * u);
    const seam = Math.floor(noise * tile * 0.8) + 4;
    ctx.fillRect(px + seam, py, 1.5 * u, tile / 2);
    ctx.fillRect(px + ((seam * 2.3) % tile), py + tile / 2, 1.5 * u, tile / 2);
  } else if (kind === 'plank2') {
    ctx.fillStyle = noise > 0.5 ? '#e6cb9f' : '#dfc294';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(120, 82, 40, 0.2)';
    ctx.fillRect(px, py, 1.5 * u, tile);
    ctx.fillRect(px + tile / 2, py, 1.5 * u, tile);
    ctx.fillRect(px, py + Math.floor(noise * tile * 0.8) + 4, tile / 2, 1.5 * u);
  } else if (kind === 'stone') {
    ctx.fillStyle = (x + y) % 2 === 0 ? '#d8d3c8' : '#cfc9bc';
    ctx.fillRect(px, py, tile, tile);
    ctx.strokeStyle = 'rgba(90, 85, 75, 0.3)';
    ctx.lineWidth = 1.5 * u;
    ctx.strokeRect(px + 0.75, py + 0.75, tile - 1.5, tile - 1.5);
  } else if (kind === 'dark') {
    ctx.fillStyle = noise > 0.5 ? '#b58c5f' : '#ad8356';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(70, 40, 15, 0.3)';
    ctx.fillRect(px, py, 1.5 * u, tile);
    ctx.fillRect(px + tile / 2, py, 1.5 * u, tile);
    ctx.fillRect(px, py + Math.floor(noise * tile * 0.8) + 4, tile / 2, 1.5 * u);
  } else if (kind === 'shop' || kind === 'mint' || kind === 'ice') {
    const [a, b, line] =
      kind === 'shop' ? ['#f0dfb6', '#e7d2a2', 'rgba(140, 100, 50, 0.22)'] : kind === 'mint' ? ['#dfeccb', '#d2e3bb', 'rgba(100, 140, 70, 0.26)'] : ['#dcedf5', '#cde1ec', 'rgba(90, 130, 160, 0.3)'];
    ctx.fillStyle = (x + y) % 2 === 0 ? (a as string) : (b as string);
    ctx.fillRect(px, py, tile, tile);
    ctx.strokeStyle = line as string;
    ctx.lineWidth = 1.5 * u;
    ctx.strokeRect(px + 0.75, py + 0.75, tile - 1.5, tile - 1.5);
    if (kind === 'ice' && noise > 0.6) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.lineWidth = 2 * u;
      ctx.beginPath();
      ctx.moveTo(px + tile * 0.2, py + tile * 0.7);
      ctx.lineTo(px + tile * 0.5, py + tile * 0.3);
      ctx.stroke();
    }
  } else if (kind === 'soil') {
    ctx.fillStyle = noise > 0.5 ? '#b38d5f' : '#ab8557';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(90, 58, 26, 0.2)';
    ctx.fillRect(px, py + tile * 0.24, tile, 2 * u);
    ctx.fillRect(px, py + tile * 0.74, tile, 2 * u);
    if (noise > 0.72) {
      // 小さな草
      ctx.strokeStyle = '#6f9a3a';
      ctx.lineWidth = 2 * u;
      const gx = px + tile * (0.2 + rand(x * 5 + y) * 0.6);
      const gy = py + tile * (0.3 + rand(x + y * 5) * 0.5);
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx - 4 * u, gy - 9 * u);
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + 1 * u, gy - 11 * u);
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + 5 * u, gy - 8 * u);
      ctx.stroke();
    }
  } else if (kind === 'earth') {
    ctx.fillStyle = noise > 0.5 ? '#ccaa7e' : '#c6a377';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(110, 76, 40, 0.22)';
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(px + rand(x * 7 + y * 3 + i) * tile, py + rand(x * 3 + y * 11 + i) * tile, (1.5 + rand(x + y + i) * 2) * u, 0, Math.PI * 2);
      ctx.fill();
    }
  } else if (kind === 'gravel') {
    ctx.fillStyle = noise > 0.5 ? '#dcd5c2' : '#d5cdb9';
    ctx.fillRect(px, py, tile, tile);
    ctx.fillStyle = 'rgba(120, 112, 92, 0.3)';
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.arc(px + rand(x * 7 + y * 3 + i) * tile, py + rand(x * 3 + y * 11 + i) * tile, (1.4 + rand(x + y + i) * 1.6) * u, 0, Math.PI * 2);
      ctx.fill();
    }
    if ((x * 7 + y * 3) % 11 === 0) {
      // 飛び石
      ctx.beginPath();
      ctx.ellipse(px + tile / 2, py + tile / 2, tile * 0.36, tile * 0.28, noise, 0, Math.PI * 2);
      ctx.fillStyle = '#b3ad9c';
      ctx.fill();
      ctx.strokeStyle = 'rgba(70, 64, 50, 0.45)';
      ctx.lineWidth = 2 * u;
      ctx.stroke();
    }
  } else {
    // 畳（2枚で1組。縁は濃い緑）
    ctx.fillStyle = (x + y) % 2 === 0 ? '#cdd79f' : '#c5d096';
    ctx.fillRect(px, py, tile, tile);
    ctx.strokeStyle = 'rgba(100, 125, 60, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 4; i < tile; i += 6) {
      ctx.beginPath();
      if (y % 2 === 0) {
        ctx.moveTo(px, py + i);
        ctx.lineTo(px + tile, py + i);
      } else {
        ctx.moveTo(px + i, py);
        ctx.lineTo(px + i, py + tile);
      }
      ctx.stroke();
    }
    ctx.fillStyle = '#5f7a3a';
    if (y % 2 === 0) {
      ctx.fillRect(px, py, tile, 3);
      if (x % 2 === 1) ctx.fillRect(px, py, 3, tile);
    } else {
      ctx.fillRect(px, py, 3, tile);
      if (x % 2 === 0) ctx.fillRect(px, py, tile, 3);
    }
  }
}

/** 壁にかけた、ざる。 */
function drawSieve(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#e2c48a';
  ctx.fill();
  outline(ctx, 2);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2);
  ctx.clip();
  ctx.strokeStyle = 'rgba(140, 100, 50, 0.55)';
  ctx.lineWidth = 1.4;
  for (let i = -3; i <= 3; i++) {
    ctx.beginPath();
    ctx.moveTo(x + i * r * 0.28, y - r);
    ctx.lineTo(x + i * r * 0.28, y + r);
    ctx.moveTo(x - r, y + i * r * 0.28);
    ctx.lineTo(x + r, y + i * r * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

/** 壁に立てかけた道具（杵とほうき、または、のこぎり）。 */
function drawWallTools(ctx: Ctx, x: number, baseY: number, tile: number, first: boolean): void {
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = '#8a5a36';
  ctx.lineWidth = tile * 0.07;
  if (first) {
    ctx.beginPath();
    ctx.moveTo(x - tile * 0.5, baseY);
    ctx.lineTo(x - tile * 0.3, baseY - tile * 0.5);
    ctx.stroke();
    ctx.save();
    ctx.translate(x - tile * 0.3, baseY - tile * 0.5);
    ctx.rotate(0.38);
    roundRect(ctx, -tile * 0.24, -tile * 0.1, tile * 0.48, tile * 0.2, 4);
    ctx.fillStyle = '#d2a56c';
    ctx.fill();
    outline(ctx, 2);
    ctx.restore();
    // ほうき
    ctx.strokeStyle = '#8a5a36';
    ctx.lineWidth = tile * 0.05;
    ctx.beginPath();
    ctx.moveTo(x + tile * 0.4, baseY - tile * 0.56);
    ctx.lineTo(x + tile * 0.3, baseY - tile * 0.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + tile * 0.2, baseY - tile * 0.22);
    ctx.lineTo(x + tile * 0.42, baseY - tile * 0.18);
    ctx.lineTo(x + tile * 0.4, baseY);
    ctx.lineTo(x + tile * 0.12, baseY);
    ctx.closePath();
    ctx.fillStyle = '#d9b45c';
    ctx.fill();
    outline(ctx, 2);
  } else {
    // のこぎり
    ctx.beginPath();
    ctx.moveTo(x - tile * 0.5, baseY - tile * 0.42);
    ctx.lineTo(x + tile * 0.3, baseY - tile * 0.5);
    ctx.lineTo(x + tile * 0.3, baseY - tile * 0.3);
    ctx.lineTo(x - tile * 0.5, baseY - tile * 0.34);
    ctx.closePath();
    ctx.fillStyle = '#c5ccd4';
    ctx.fill();
    outline(ctx, 2);
    roundRect(ctx, x + tile * 0.28, baseY - tile * 0.54, tile * 0.26, tile * 0.28, 5);
    ctx.fillStyle = '#8a5a36';
    ctx.fill();
    outline(ctx, 2);
  }
  ctx.restore();
}

function outline(ctx: Ctx, width = 2.4): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function drawShelf(ctx: Ctx, x: number, baseY: number, w: number, h: number, seed: number): void {
  ctx.fillStyle = '#7a4e2c';
  roundRect(ctx, x, baseY - h, w, h, 3);
  ctx.fill();
  outline(ctx, 2);
  ctx.fillStyle = '#5a3619';
  ctx.fillRect(x + 2, baseY - h / 2 - 1.5, w - 4, 3);
  const slots = Math.floor(w / 26);
  for (let row = 0; row < 2; row++) {
    for (let i = 0; i < slots; i++) {
      const cx = x + 14 + i * ((w - 28) / Math.max(1, slots - 1));
      const cy = baseY - (row === 0 ? h * 0.5 : 0) - 3;
      const pick = rand(seed * 9 + row * 5 + i);
      if (pick < 0.45) {
        roundRect(ctx, cx - 9, cy - 14, 18, 14, 5);
        ctx.fillStyle = '#efe4c4';
        ctx.fill();
        outline(ctx, 1.6);
      } else if (pick < 0.8) {
        ctx.beginPath();
        ctx.rect(cx - 8, cy - 13, 16, 13);
        ctx.fillStyle = '#c9975a';
        ctx.fill();
        outline(ctx, 1.6);
      } else {
        ctx.beginPath();
        ctx.arc(cx, cy - 7, 7, 0, Math.PI * 2);
        ctx.fillStyle = ZUNDA;
        ctx.fill();
        outline(ctx, 1.6);
      }
    }
  }
}

function drawNoren(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x - 6, y - 4, w + 12, 5);
  const strips = 4;
  for (let i = 0; i < strips; i++) {
    const sx = x + (w / strips) * i;
    roundRect(ctx, sx + 1.5, y, w / strips - 3, h, 3);
    ctx.fillStyle = ZUNDA_DARK;
    ctx.fill();
    outline(ctx, 2);
  }
  zundaMochi(ctx, x + w / 2, y + h * 0.52, h * 0.24);
}

function drawTray(ctx: Ctx, x: number, baseY: number, w: number): void {
  roundRect(ctx, x - w / 2, baseY - 12, w, 12, 3);
  ctx.fillStyle = '#9c2f2a';
  ctx.fill();
  outline(ctx, 2);
  for (const dx of [-0.26, 0, 0.26]) zundaMochi(ctx, x + dx * w, baseY - 17, 7);
}

function drawShoji(ctx: Ctx, x: number, y: number, w: number, h: number): void {
  roundRect(ctx, x, y, w, h, 2);
  ctx.fillStyle = '#fdf8ea';
  ctx.fill();
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = 1; i < 6; i++) {
    ctx.moveTo(x + (w / 6) * i, y);
    ctx.lineTo(x + (w / 6) * i, y + h);
  }
  ctx.moveTo(x, y + h / 2);
  ctx.lineTo(x + w, y + h / 2);
  ctx.stroke();
}

function drawScroll(ctx: Ctx, x: number, y: number, w: number, h: number, label: string): void {
  ctx.fillStyle = '#f7efd9';
  ctx.fillRect(x - w / 2, y, w, h);
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 2;
  ctx.strokeRect(x - w / 2, y, w, h);
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(x - w / 2 - 3, y - 3, w + 6, 4);
  ctx.fillRect(x - w / 2 - 3, y + h - 1, w + 6, 4);
  ctx.save();
  ctx.font = `700 ${h * 0.34}px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = INK;
  ctx.fillText(label, x, y + h * 0.5);
  ctx.restore();
}

function drawCushion(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  roundRect(ctx, x - r, y - r * 0.8, r * 2, r * 1.6, r * 0.4);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = 0.8;
  outline(ctx, 2);
  ctx.globalAlpha = 1;
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.16, 0, Math.PI * 2);
  ctx.fill();
}

function drawNameplate(ctx: Ctx, x: number, y: number, name: string, tile: number): void {
  const w = Math.max(tile * 1.7, [...name].length * tile * 0.42 + 26);
  const h = tile * 0.5;
  roundRect(ctx, x - w / 2, y - h / 2, w, h, 6);
  ctx.fillStyle = '#6b4226';
  ctx.fill();
  outline(ctx, 2.4);
  drawText(ctx, name, x, y + 1, { size: tile * 0.34, color: PAPER, align: 'center', weight: 700 });
}

function drawLantern(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.fillStyle = INK;
  ctx.fillRect(x - 1, y - r * 1.8, 2, r * 0.7);
  ctx.beginPath();
  ctx.ellipse(x, y, r * 0.86, r * 1.12, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f6d98a';
  ctx.fill();
  outline(ctx, 2);
  ctx.fillStyle = INK;
  ctx.fillRect(x - r * 0.5, y - r * 1.2, r, 3.5);
  ctx.fillRect(x - r * 0.5, y + r * 0.98, r, 3.5);
}


export interface ViewBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** 動く部分: 壁ぎわの湯気、夜明け前の暗さ、明かり。daylight は 0（夜明け前）〜1（開店の時刻）。view は画面に入っている範囲（マップの絵の中のピクセル）。 */
export function drawAtmosphere(ctx: Ctx, shop: Workshop, time: number, daylight: number, view: ViewBox): void {
  const inView = (x: number, y: number, pad: number) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;
  // 湯気
  for (const [index, source] of shop.steamers.entries()) {
    if (!inView(source.x, source.y, shop.tile * 2)) continue;
    for (let i = 0; i < 5; i++) {
      const k = (time * 0.32 + i / 5 + rand(index * 7 + i) * 0.4) % 1;
      const x = source.x + Math.sin(k * 5 + i + index) * shop.tile * 0.1;
      const y = source.y - k * shop.tile * 0.9;
      ctx.beginPath();
      ctx.arc(x, y, shop.tile * (0.07 + k * 0.14), 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, 255, 255, ${0.42 * Math.sin(k * Math.PI)})`;
      ctx.fill();
    }
  }
  // 夜明け前の暗さ（開店が近づくほど明るくなる）
  const dark = lerp(0.3, 0, daylight);
  if (dark > 0.005) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(96, 108, 170, ${dark * 1.5})`;
    ctx.fillRect(view.x0, view.y0, view.x1 - view.x0, view.y1 - view.y0);
    ctx.restore();
  }
  // 提灯や火の明かり（暗いうちほど強い）
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const strength = lerp(0.42, 0.1, daylight);
  for (const [index, lamp] of shop.lights.entries()) {
    const radius = lamp.radius * (0.9 + Math.sin(time * 3 + index * 2.1) * 0.06);
    if (!inView(lamp.x, lamp.y, radius)) continue;
    const g = ctx.createRadialGradient(lamp.x, lamp.y, 2, lamp.x, lamp.y, radius);
    g.addColorStop(0, `rgba(255, 200, 110, ${strength})`);
    g.addColorStop(1, 'rgba(255, 200, 110, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(lamp.x - radius, lamp.y - radius, radius * 2, radius * 2);
  }
  ctx.restore();
}

/** 集会の場面の背景（休憩室に集まった絵）。 */
export function drawMeetingRoom(ctx: Ctx, w: number, h: number, time: number, daylight: number): void {
  const floorY = h * 0.5;
  // 壁
  const wall = ctx.createLinearGradient(0, 0, 0, floorY);
  wall.addColorStop(0, '#e8d9b8');
  wall.addColorStop(1, '#f3e8cf');
  ctx.fillStyle = wall;
  ctx.fillRect(0, 0, w, floorY);
  // 障子（外の明るさが透ける）
  const outside = `rgb(${Math.round(lerp(70, 255, daylight))}, ${Math.round(lerp(86, 236, daylight))}, ${Math.round(lerp(150, 190, daylight))})`;
  for (const cx of [w * 0.2, w * 0.8]) {
    const sw = w * 0.2;
    const sh = floorY * 0.62;
    const sx = cx - sw / 2;
    const sy = floorY * 0.2;
    ctx.fillStyle = outside;
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = 'rgba(255, 252, 240, 0.72)';
    ctx.fillRect(sx, sy, sw, sh);
    ctx.strokeStyle = WOOD_DARK;
    ctx.lineWidth = 10;
    ctx.strokeRect(sx, sy, sw, sh);
    ctx.lineWidth = 4;
    ctx.beginPath();
    for (let i = 1; i < 6; i++) {
      ctx.moveTo(sx + (sw / 6) * i, sy);
      ctx.lineTo(sx + (sw / 6) * i, sy + sh);
    }
    for (let i = 1; i < 3; i++) {
      ctx.moveTo(sx, sy + (sh / 3) * i);
      ctx.lineTo(sx + sw, sy + (sh / 3) * i);
    }
    ctx.stroke();
  }
  // 梁と、鐘
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(0, floorY * 0.06, w, 26);
  ctx.fillStyle = WOOD;
  ctx.fillRect(0, floorY * 0.06 + 26, w, 6);
  // 畳の床
  const floor = ctx.createLinearGradient(0, floorY, 0, h);
  floor.addColorStop(0, '#c2cd92');
  floor.addColorStop(1, '#d3dca8');
  ctx.fillStyle = floor;
  ctx.fillRect(0, floorY, w, h - floorY);
  ctx.strokeStyle = '#5f7a3a';
  ctx.lineWidth = 6;
  for (let i = -1; i <= 5; i++) {
    const topX = w / 2 + (i - 2) * w * 0.2;
    const bottomX = w / 2 + (i - 2) * w * 0.42;
    ctx.beginPath();
    ctx.moveTo(topX, floorY);
    ctx.lineTo(bottomX, h);
    ctx.stroke();
  }
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(0, floorY - 10, w, 16);
  // ちゃぶ台と、ずんだ餅
  const tx = w / 2;
  const ty = h * 0.67;
  ctx.fillStyle = 'rgba(40, 24, 10, 0.2)';
  ctx.beginPath();
  ctx.ellipse(tx, ty + 50, w * 0.2, 34, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#6e4526';
  for (const k of [-1, 1]) ctx.fillRect(tx + k * w * 0.13 - 9, ty, 18, 48);
  ctx.beginPath();
  ctx.ellipse(tx, ty, w * 0.19, 40, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#9a6337';
  ctx.fill();
  outline(ctx, 4);
  ctx.beginPath();
  ctx.ellipse(tx, ty - 6, w * 0.19, 40, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#b87a48';
  ctx.fill();
  outline(ctx, 4);
  ctx.beginPath();
  ctx.ellipse(tx, ty - 10, 92, 20, 0, 0, Math.PI * 2);
  ctx.fillStyle = MOCHI;
  ctx.fill();
  outline(ctx, 3);
  for (const dx of [-48, 0, 48]) zundaMochi(ctx, tx + dx, ty - 22, 20);
  // 湯のみの湯気
  for (let i = 0; i < 3; i++) {
    const k = (time * 0.3 + i / 3) % 1;
    ctx.beginPath();
    ctx.arc(tx + 150 + Math.sin(k * 5 + i) * 6, ty - 30 - k * 60, 6 + k * 8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,255,255,${0.4 * Math.sin(k * Math.PI)})`;
    ctx.fill();
  }
  roundRect(ctx, tx + 136, ty - 30, 28, 24, 5);
  ctx.fillStyle = '#5f8fae';
  ctx.fill();
  outline(ctx, 3);
  // 夜明け前の暗さ
  const dark = lerp(0.22, 0, daylight);
  if (dark > 0.005) {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(110, 120, 180, ${dark * 1.6})`;
    ctx.fillRect(0, 0, w, h);
    ctx.restore();
  }
}
