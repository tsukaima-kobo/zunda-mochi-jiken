// 工房の道具（見取り図の盤・名札かけ・防犯カメラの画面）と、廊下の防犯カメラの絵。
// 動かない部分は、工房の下絵（workshop.ts）に一度だけ描く。名札の色・画面の明かり・カメラの赤いランプは、毎コマ描く（scenes.ts）。
// 絵はすべてコードで描く（外の素材は使わない）。座標は工房の絵のピクセル（tile は升目1つの大きさ）。

import type { CameraPoint, MapDevices } from '../../sim/src/index.ts';
import { roundRect, WOOD, WOOD_DARK } from './theme.ts';
import type { Ctx } from './theme.ts';

export type DeviceKind = 'admin' | 'vitals' | 'cameras';

/** 壁の道具の大きさ（升）。名札を置く場所を、ほかの壁の飾りと重ねないために使う。 */
export const DEVICE_WIDTH: Record<DeviceKind, number> = { admin: 2.2, vitals: 2.4, cameras: 2 };

/** 名札かけの名札の並び（横の数）。 */
const TAG_COLUMNS = 6;

function ink(ctx: Ctx, width: number, color = WOOD_DARK): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** 壁の面に、道具の板を描く枠。cx は真ん中、base は壁の面の下端。 */
function boardRect(kind: DeviceKind, cx: number, base: number, tile: number): { x: number; y: number; w: number; h: number } {
  const w = DEVICE_WIDTH[kind] * tile;
  const h = tile * (kind === 'cameras' ? 1.02 : 0.98);
  return { x: cx - w / 2, y: base - tile * 0.1 - h, w, h };
}

/** 道具の板（動かない部分）。 */
export function drawDeviceBoard(ctx: Ctx, kind: DeviceKind, cx: number, base: number, tile: number): void {
  const u = tile / 64;
  const r = boardRect(kind, cx, base, tile);
  // 壁に落ちる影
  ctx.fillStyle = 'rgba(40, 22, 8, 0.22)';
  roundRect(ctx, r.x + 4 * u, r.y + 6 * u, r.w, r.h, 8 * u);
  ctx.fill();
  if (kind === 'cameras') {
    // 防犯カメラの画面: 黒い枠の中に、小さな画面が2×2
    roundRect(ctx, r.x, r.y, r.w, r.h, 8 * u);
    ctx.fillStyle = '#3d434b';
    ctx.fill();
    ink(ctx, 3 * u, '#22262b');
    for (const s of screenRects(cx, base, tile)) {
      roundRect(ctx, s.x, s.y, s.w, s.h, 3 * u);
      ctx.fillStyle = '#1f2a2c';
      ctx.fill();
      ink(ctx, 1.6 * u, '#14191b');
      // 消えている画面のつや
      ctx.fillStyle = 'rgba(255, 255, 255, 0.07)';
      ctx.fillRect(s.x + s.w * 0.08, s.y + s.h * 0.12, s.w * 0.3, s.h * 0.16);
    }
    // 台の木と、小さなつまみ
    ctx.fillStyle = WOOD;
    ctx.fillRect(r.x - 6 * u, r.y + r.h - 2 * u, r.w + 12 * u, 9 * u);
    ctx.fillStyle = '#c9ced4';
    for (const k of [0.82, 0.92]) {
      ctx.beginPath();
      ctx.arc(r.x + r.w * k, r.y + r.h - 8 * u, 3.2 * u, 0, Math.PI * 2);
      ctx.fill();
    }
    return;
  }
  // 木の枠と、紙の板
  roundRect(ctx, r.x, r.y, r.w, r.h, 8 * u);
  ctx.fillStyle = WOOD;
  ctx.fill();
  ink(ctx, 3 * u);
  const pad = 7 * u;
  roundRect(ctx, r.x + pad, r.y + pad, r.w - pad * 2, r.h - pad * 2, 5 * u);
  ctx.fillStyle = kind === 'admin' ? '#f4ead0' : '#c79a64';
  ctx.fill();
  if (kind === 'admin') {
    // 小さな見取り図: 部屋の色の四角と、廊下のすき間
    const ix = r.x + pad * 1.8;
    const iy = r.y + pad * 1.8;
    const iw = r.w - pad * 3.6;
    const ih = r.h - pad * 3.6;
    const colors = ['#cfe3a8', '#e8d3a8', '#bcd6e8', '#e8c3b5', '#d9cfe8', '#f0e1a0'];
    const cols = 4;
    const rows = 3;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (x === 1 && y === 1) continue; // 真ん中は中庭（あけておく）
        const bw = iw / cols;
        const bh = ih / rows;
        ctx.fillStyle = colors[(x * 2 + y) % colors.length] as string;
        ctx.fillRect(ix + x * bw + 1.6 * u, iy + y * bh + 1.6 * u, bw - 3.2 * u, bh - 3.2 * u);
      }
    }
    ctx.strokeStyle = 'rgba(94, 59, 34, 0.55)';
    ctx.lineWidth = 1.4 * u;
    ctx.strokeRect(ix, iy, iw, ih);
    // 画びょう
    for (const [k, color] of [[0.06, '#c0392b'], [0.94, '#5f8f2c']] as const) {
      ctx.beginPath();
      ctx.arc(r.x + r.w * k, r.y + pad * 0.6, 3.4 * u, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    }
  } else {
    // 名札をかける釘
    for (const t of tagRects(cx, base, tile, TAG_COLUMNS * 2)) {
      ctx.beginPath();
      ctx.arc(t.x + t.w / 2, t.y - 2.5 * u, 2.2 * u, 0, Math.PI * 2);
      ctx.fillStyle = '#6b5a48';
      ctx.fill();
    }
  }
}

/** 防犯カメラの画面の、小さな画面4つ（左上・右上・左下・右下）。 */
export function screenRects(cx: number, base: number, tile: number): { x: number; y: number; w: number; h: number }[] {
  const u = tile / 64;
  const r = boardRect('cameras', cx, base, tile);
  const gap = 5 * u;
  const pad = 7 * u;
  const sw = (r.w - pad * 2 - gap) / 2;
  const sh = (r.h - pad * 2 - gap - 8 * u) / 2;
  return [0, 1, 2, 3].map((i) => ({ x: r.x + pad + (i % 2) * (sw + gap), y: r.y + pad + Math.floor(i / 2) * (sh + gap), w: sw, h: sh }));
}

/** 名札かけの名札の位置（名簿順。6つずつ2段）。 */
export function tagRects(cx: number, base: number, tile: number, count: number): { x: number; y: number; w: number; h: number }[] {
  const u = tile / 64;
  const r = boardRect('vitals', cx, base, tile);
  const pad = 12 * u;
  const cell = (r.w - pad * 2) / TAG_COLUMNS;
  const w = cell * 0.74;
  const h = (r.h - pad * 2) / 2 - 6 * u;
  return Array.from({ length: count }, (_, i) => ({
    x: r.x + pad + (i % TAG_COLUMNS) * cell + (cell - w) / 2,
    y: r.y + pad + 4 * u + Math.floor(i / TAG_COLUMNS) * (h + 8 * u),
    w,
    h,
  }));
}

/** 名札かけの名札（毎コマ）。起きている人は、その人の色。ずんだ餅になった人は、裏返して緑の餅の印。クビの人は札が無い。 */
export function drawNameTags(ctx: Ctx, cx: number, base: number, tile: number, tags: readonly { color: string; dark: string; state: 'awake' | 'asleep' | 'gone' }[]): void {
  const u = tile / 64;
  tagRects(cx, base, tile, tags.length).forEach((t, i) => {
    const tag = tags[i];
    if (!tag || tag.state === 'gone') return;
    // ひも
    ctx.strokeStyle = 'rgba(70, 50, 30, 0.7)';
    ctx.lineWidth = 1.2 * u;
    ctx.beginPath();
    ctx.moveTo(t.x + t.w / 2, t.y - 2.5 * u);
    ctx.lineTo(t.x + t.w * 0.22, t.y + 1);
    ctx.moveTo(t.x + t.w / 2, t.y - 2.5 * u);
    ctx.lineTo(t.x + t.w * 0.78, t.y + 1);
    ctx.stroke();
    roundRect(ctx, t.x, t.y, t.w, t.h, 2.6 * u);
    ctx.fillStyle = tag.state === 'asleep' ? '#e9f3d8' : tag.color;
    ctx.fill();
    ink(ctx, 1.4 * u, tag.state === 'asleep' ? '#4f7a22' : tag.dark);
    if (tag.state === 'asleep') {
      ctx.beginPath();
      ctx.ellipse(t.x + t.w / 2, t.y + t.h * 0.55, t.w * 0.3, t.h * 0.26, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#9ccc52';
      ctx.fill();
    } else {
      // 名札の字の代わりの線
      ctx.fillStyle = 'rgba(255, 255, 255, 0.8)';
      ctx.fillRect(t.x + t.w * 0.25, t.y + t.h * 0.3, t.w * 0.5, 1.6 * u);
      ctx.fillRect(t.x + t.w * 0.25, t.y + t.h * 0.55, t.w * 0.5, 1.6 * u);
    }
  });
}

/** 防犯カメラの画面がついている時の明かり（毎コマ）。 */
export function drawScreensOn(ctx: Ctx, cx: number, base: number, tile: number, time: number): void {
  const u = tile / 64;
  screenRects(cx, base, tile).forEach((s, i) => {
    const g = ctx.createLinearGradient(s.x, s.y, s.x, s.y + s.h);
    g.addColorStop(0, '#bff3dc');
    g.addColorStop(1, '#6fc4a6');
    ctx.fillStyle = g;
    roundRect(ctx, s.x, s.y, s.w, s.h, 3 * u);
    ctx.fill();
    // 走査線と、映っている廊下の線
    ctx.fillStyle = 'rgba(20, 60, 50, 0.18)';
    for (let y = s.y + ((time * 14 + i * 3) % 4) * u; y < s.y + s.h; y += 4 * u) ctx.fillRect(s.x, y, s.w, 1.2 * u);
    ctx.strokeStyle = 'rgba(30, 80, 64, 0.5)';
    ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    ctx.moveTo(s.x + s.w * 0.15, s.y + s.h * 0.85);
    ctx.lineTo(s.x + s.w * 0.4, s.y + s.h * 0.35);
    ctx.moveTo(s.x + s.w * 0.85, s.y + s.h * 0.85);
    ctx.lineTo(s.x + s.w * 0.6, s.y + s.h * 0.35);
    ctx.stroke();
  });
  // 画面の光が、まわりの壁にもれる
  const r = boardRect('cameras', cx, base, tile);
  const glow = ctx.createRadialGradient(cx, r.y + r.h / 2, tile * 0.3, cx, r.y + r.h / 2, tile * 1.8);
  glow.addColorStop(0, 'rgba(160, 240, 210, 0.22)');
  glow.addColorStop(1, 'rgba(160, 240, 210, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(cx - tile * 1.8, r.y + r.h / 2 - tile * 1.8, tile * 3.6, tile * 3.6);
}

/** 廊下の防犯カメラの大きさ（升目に対する倍率）。画面の上で、廊下にカメラがあると分かる大きさ。 */
const CAMERA_SIZE = 1.7;

/** 廊下の防犯カメラを取り付けた所（絵のピクセル）。facing は、レンズの向き。 */
export function cameraMount(camera: CameraPoint, tile: number): { x: number; y: number; facing: 'down' | 'left' | 'right' } {
  const wall = camera.wall ?? { x: camera.x, y: camera.y - 1 };
  if (wall.y === camera.y) {
    // 縦の廊下の、横の壁（上から見た壁の上に、横向きに付ける）
    const facing = wall.x < camera.x ? 'right' : 'left';
    return { x: (wall.x + (facing === 'right' ? 0.78 : 0.22)) * tile, y: (wall.y + 0.4) * tile, facing };
  }
  // 横の廊下の、奥の壁の面
  return { x: (wall.x + 0.5) * tile, y: (wall.y + 0.66) * tile, facing: 'down' };
}

/** 廊下の防犯カメラ（動かない部分）。 */
export function drawWallCamera(ctx: Ctx, camera: CameraPoint, tile: number): void {
  const u = (tile / 64) * CAMERA_SIZE;
  const m = cameraMount(camera, tile);
  ctx.save();
  ctx.translate(m.x, m.y);
  if (m.facing === 'left') ctx.scale(-1, 1);
  if (m.facing === 'down') {
    // 腕と、下向きの箱
    ctx.fillStyle = '#7d848c';
    ctx.fillRect(-2.5 * u, -14 * u, 5 * u, 10 * u);
    roundRect(ctx, -13 * u, -6 * u, 26 * u, 15 * u, 4 * u);
    ctx.fillStyle = '#e4e7ea';
    ctx.fill();
    ink(ctx, 2 * u, '#4a5058');
    ctx.beginPath();
    ctx.arc(0, 4 * u, 5.5 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#2c3238';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-1.6 * u, 2.6 * u, 1.8 * u, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.fill();
  } else {
    // 横向き（右を向いた形。左向きは、上で裏返した）
    ctx.fillStyle = '#7d848c';
    ctx.fillRect(-12 * u, -2.5 * u, 10 * u, 5 * u);
    roundRect(ctx, -4 * u, -8 * u, 22 * u, 16 * u, 4 * u);
    ctx.fillStyle = '#e4e7ea';
    ctx.fill();
    ink(ctx, 2 * u, '#4a5058');
    ctx.beginPath();
    ctx.arc(16 * u, 0, 5 * u, 0, Math.PI * 2);
    ctx.fillStyle = '#2c3238';
    ctx.fill();
  }
  ctx.restore();
}

/** 防犯カメラの赤いランプ（毎コマ）。on の時だけ光る。 */
export function drawCameraLamp(ctx: Ctx, camera: CameraPoint, tile: number, on: boolean, time: number): void {
  const u = (tile / 64) * CAMERA_SIZE;
  const m = cameraMount(camera, tile);
  const x = m.facing === 'down' ? m.x + 8 * u : m.x + (m.facing === 'right' ? 4 : -4) * u;
  const y = m.facing === 'down' ? m.y - 2 * u : m.y - 4 * u;
  if (on) {
    const pulse = 0.75 + 0.25 * Math.sin(time * 6);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, tile * 0.8);
    glow.addColorStop(0, `rgba(255, 60, 40, ${0.6 * pulse})`);
    glow.addColorStop(1, 'rgba(255, 60, 40, 0)');
    ctx.fillStyle = glow;
    ctx.fillRect(x - tile * 0.8, y - tile * 0.8, tile * 1.6, tile * 1.6);
  }
  ctx.beginPath();
  ctx.arc(x, y, 3.4 * u, 0, Math.PI * 2);
  ctx.fillStyle = on ? '#ff3b2a' : '#6e2a24';
  ctx.fill();
}

/** マップに書かれた道具の、壁の上での真ん中（絵のピクセル）。道具の升目の、すぐ奥の壁にかける。 */
export function deviceSpot(devices: MapDevices | undefined, kind: DeviceKind, tile: number): { cx: number; base: number; wallY: number; x: number } | null {
  const device = devices?.[kind];
  if (!device) return null;
  return { cx: (device.x + 0.5) * tile, base: device.y * tile, wallY: device.y - 1, x: device.x };
}
