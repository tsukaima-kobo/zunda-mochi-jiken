// 工房の家具と道具の絵。すべてこの場で描く（画像ファイルは使わない）。
// 家具は登場人物と同じ順（奥から手前）で毎コマ描くので、家具の向こうを歩く人は家具に少し隠れる。
// 座標はマップの絵の中のピクセル。t は升目1つの大きさ。

import { INK, MOCHI, rand, roundRect, ZUNDA, ZUNDA_DARK, zundaMochi } from './theme.ts';
import type { Ctx } from './theme.ts';

export interface PropBox {
  kind: string;
  top?: string;
  /** 置いてある升目（左上と広さ）。 */
  x: number;
  y: number;
  w: number;
  h: number;
}

function ink(ctx: Ctx, width: number): void {
  ctx.lineWidth = width;
  ctx.strokeStyle = INK;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/** 足もとの影。 */
function shadow(ctx: Ctx, px: number, py: number, pw: number, ph: number, t: number): void {
  ctx.beginPath();
  ctx.ellipse(px + pw / 2, py + ph - t * 0.06, pw * 0.5, Math.min(ph * 0.34, t * 0.34), 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(40, 24, 10, 0.2)';
  ctx.fill();
}

/** 箱の形の家具（上の面と、手前の面）。上の面の四角を返す。 */
function boxy(ctx: Ctx, px: number, py: number, pw: number, ph: number, t: number, lift: number, top: string, front: string, radius = 0.08): { x: number; y: number; w: number; h: number } {
  const m = t * 0.07;
  const u = t / 72;
  const x = px + m;
  const w = pw - m * 2;
  const bottom = py + ph - m;
  const y0 = py + m - lift * t;
  const y1 = bottom - lift * t;
  shadow(ctx, px, py, pw, ph, t);
  roundRect(ctx, x, y1 - radius * t, w, bottom - y1 + radius * t, radius * t);
  ctx.fillStyle = front;
  ctx.fill();
  ink(ctx, 2.6 * u);
  roundRect(ctx, x, y0, w, y1 - y0, radius * t);
  ctx.fillStyle = top;
  ctx.fill();
  ink(ctx, 2.6 * u);
  return { x, y: y0, w, h: y1 - y0 };
}

function steam(ctx: Ctx, x: number, y: number, t: number, time: number, seed: number, strength = 1): void {
  for (let i = 0; i < 4; i++) {
    const k = (time * 0.3 + i / 4 + rand(seed * 7 + i) * 0.4) % 1;
    ctx.beginPath();
    ctx.arc(x + Math.sin(k * 5 + i + seed) * t * 0.1, y - k * t * 0.95, t * (0.07 + k * 0.15), 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255, 255, 255, ${0.4 * strength * Math.sin(k * Math.PI)})`;
    ctx.fill();
  }
}

/** せいろ（蒸し器）を重ねたもの。 */
export function drawSteamer(ctx: Ctx, x: number, baseY: number, r: number, stack: number): void {
  const h = r * 0.62;
  for (let i = 0; i < stack; i++) {
    const y = baseY - (i + 1) * h;
    roundRect(ctx, x - r, y, r * 2, h, 4);
    ctx.fillStyle = '#e2bf82';
    ctx.fill();
    ink(ctx, 2);
    ctx.fillStyle = '#b98a4a';
    ctx.fillRect(x - r + 2, y + h * 0.36, r * 2 - 4, 3);
  }
  ctx.beginPath();
  ctx.ellipse(x, baseY - stack * h, r * 1.04, r * 0.26, 0, Math.PI, 0);
  ctx.closePath();
  ctx.fillStyle = '#edd29c';
  ctx.fill();
  ink(ctx, 2);
}

function bowl(ctx: Ctx, x: number, y: number, r: number, fill: string): void {
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * 0.62, 0, 0, Math.PI * 2);
  ctx.fillStyle = '#f4ead2';
  ctx.fill();
  ink(ctx, Math.max(1.4, r * 0.14));
  ctx.beginPath();
  ctx.ellipse(x, y - r * 0.06, r * 0.72, r * 0.4, 0, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function log(ctx: Ctx, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle = '#d2a56c';
  ctx.fill();
  ink(ctx, Math.max(1.4, r * 0.16));
  ctx.beginPath();
  ctx.arc(x, y, r * 0.5, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(120, 78, 40, 0.6)';
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.stroke();
}

/** 集会の鐘。swing は振れ（-1〜1）。 */
export function drawBell(ctx: Ctx, x: number, y: number, r: number, swing: number): void {
  ctx.save();
  ctx.translate(x, y - r * 1.5);
  ctx.fillStyle = INK;
  ctx.fillRect(-r * 0.9, -3, r * 1.8, 5);
  ctx.rotate(swing * 0.5);
  ctx.fillRect(-1.5, 0, 3, r * 0.6);
  ctx.translate(0, r * 0.5);
  ctx.beginPath();
  ctx.moveTo(-r * 0.36, 0);
  ctx.quadraticCurveTo(-r * 0.46, r * 0.9, -r * 0.96, r * 1.34);
  ctx.lineTo(r * 0.96, r * 1.34);
  ctx.quadraticCurveTo(r * 0.46, r * 0.9, r * 0.36, 0);
  ctx.closePath();
  ctx.fillStyle = '#e0a93a';
  ctx.fill();
  ink(ctx, Math.max(2, r * 0.09));
  ctx.fillStyle = 'rgba(255, 245, 200, 0.6)';
  ctx.beginPath();
  ctx.ellipse(-r * 0.3, r * 0.7, r * 0.1, r * 0.36, 0.3, 0, Math.PI * 2);
  ctx.fill();
  // 舌（中の玉）は、鐘と逆に振れる
  ctx.beginPath();
  ctx.arc(-swing * r * 0.5, r * 1.44, r * 0.2, 0, Math.PI * 2);
  ctx.fillStyle = '#8a5a14';
  ctx.fill();
  ink(ctx, Math.max(1.6, r * 0.07));
  ctx.restore();
}

/** 家具を1つ描く。time は湯気や火のゆらぎに使う。 */
export function drawProp(ctx: Ctx, prop: PropBox, t: number, time: number): void {
  const px = prop.x * t;
  const py = prop.y * t;
  const pw = prop.w * t;
  const ph = prop.h * t;
  const cx = px + pw / 2;
  const u = t / 72;
  const seed = prop.x * 31 + prop.y * 17;
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  switch (prop.kind) {
    case 'crop': {
      // 枝豆のうね
      roundRect(ctx, px + 3 * u, py + ph * 0.42, pw - 6 * u, ph * 0.52, 14 * u);
      ctx.fillStyle = '#8a6238';
      ctx.fill();
      ink(ctx, 2.4 * u);
      for (let i = 0; i < prop.w * 2; i++) {
        const bx = px + (i + 0.5) * (t / 2);
        const by = py + ph * 0.5 + (rand(seed + i) - 0.5) * t * 0.08;
        for (const [dx, dy, r, fill] of [[-0.13, 0, 0.17, ZUNDA_DARK], [0.13, 0.01, 0.17, ZUNDA_DARK], [0, -0.16, 0.19, '#79aa3c']] as const) {
          ctx.beginPath();
          ctx.arc(bx + dx * t, by + dy * t, r * t, 0, Math.PI * 2);
          ctx.fillStyle = fill;
          ctx.fill();
          ink(ctx, 1.8 * u);
        }
        // さや
        ctx.beginPath();
        ctx.ellipse(bx + t * 0.04, by + t * 0.04, t * 0.09, t * 0.04, 0.5, 0, Math.PI * 2);
        ctx.fillStyle = '#c4e07a';
        ctx.fill();
      }
      break;
    }
    case 'scarecrow': {
      shadow(ctx, px, py, pw, ph, t);
      const base = py + ph * 0.9;
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 6 * u;
      ctx.beginPath();
      ctx.moveTo(cx, base);
      ctx.lineTo(cx, base - t * 1.25);
      ctx.moveTo(cx - t * 0.5, base - t * 0.8);
      ctx.lineTo(cx + t * 0.5, base - t * 0.8);
      ctx.stroke();
      roundRect(ctx, cx - t * 0.26, base - t * 0.92, t * 0.52, t * 0.5, 6 * u);
      ctx.fillStyle = '#c9783c';
      ctx.fill();
      ink(ctx, 2.2 * u);
      ctx.beginPath();
      ctx.arc(cx, base - t * 1.12, t * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = '#f1e2c0';
      ctx.fill();
      ink(ctx, 2.2 * u);
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.36, base - t * 1.2);
      ctx.lineTo(cx, base - t * 1.52);
      ctx.lineTo(cx + t * 0.36, base - t * 1.2);
      ctx.closePath();
      ctx.fillStyle = '#d9b45c';
      ctx.fill();
      ink(ctx, 2.2 * u);
      break;
    }
    case 'basket': {
      shadow(ctx, px, py, pw, ph, t);
      ctx.beginPath();
      ctx.ellipse(cx, py + ph * 0.42, t * 0.34, t * 0.2, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#79aa3c';
      ctx.fill();
      ink(ctx, 2 * u);
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.36, py + ph * 0.44);
      ctx.quadraticCurveTo(cx - t * 0.3, py + ph * 0.92, cx, py + ph * 0.92);
      ctx.quadraticCurveTo(cx + t * 0.3, py + ph * 0.92, cx + t * 0.36, py + ph * 0.44);
      ctx.quadraticCurveTo(cx, py + ph * 0.62, cx - t * 0.36, py + ph * 0.44);
      ctx.fillStyle = '#c99a58';
      ctx.fill();
      ink(ctx, 2.2 * u);
      break;
    }
    case 'trough': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.3, '#c2bdb0', '#9a958a');
      roundRect(ctx, top.x + t * 0.14, top.y + t * 0.12, top.w - t * 0.28, top.h - t * 0.24, t * 0.1);
      ctx.fillStyle = '#7fc4e0';
      ctx.fill();
      ink(ctx, 2 * u);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
      ctx.lineWidth = 2 * u;
      for (let i = 0; i < 4; i++) {
        const k = (time * 0.25 + i / 4) % 1;
        const wx = top.x + t * 0.4 + rand(seed + i) * (top.w - t * 0.8);
        const wy = top.y + t * 0.3 + rand(seed + i + 9) * (top.h - t * 0.6);
        ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
        ctx.beginPath();
        ctx.ellipse(wx, wy, t * (0.08 + k * 0.14), t * (0.04 + k * 0.06), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
      break;
    }
    case 'tub': {
      shadow(ctx, px, py, pw, ph, t);
      roundRect(ctx, cx - t * 0.34, py + ph * 0.3, t * 0.68, ph * 0.6, 6 * u);
      ctx.fillStyle = '#c99a58';
      ctx.fill();
      ink(ctx, 2.2 * u);
      ctx.fillStyle = '#7a5230';
      ctx.fillRect(cx - t * 0.34, py + ph * 0.52, t * 0.68, 3.5 * u);
      ctx.beginPath();
      ctx.ellipse(cx, py + ph * 0.3, t * 0.34, t * 0.13, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#8fcbe3';
      ctx.fill();
      ink(ctx, 2.2 * u);
      break;
    }
    case 'stove': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.5, '#d3b292', '#a8825f', 0.12);
      // たき口の火
      const n = Math.max(1, Math.floor(prop.w / 2));
      for (let i = 0; i < n; i++) {
        const fx = top.x + (top.w / n) * (i + 0.5);
        const fy = top.y + top.h + t * 0.42;
        ctx.beginPath();
        ctx.moveTo(fx - t * 0.24, fy);
        ctx.quadraticCurveTo(fx - t * 0.24, fy - t * 0.34, fx, fy - t * 0.34);
        ctx.quadraticCurveTo(fx + t * 0.24, fy - t * 0.34, fx + t * 0.24, fy);
        ctx.closePath();
        ctx.fillStyle = '#2b1a10';
        ctx.fill();
        ink(ctx, 2.2 * u);
        const flick = 0.75 + 0.25 * Math.sin(time * 9 + i * 2.3 + seed);
        ctx.beginPath();
        ctx.moveTo(fx - t * 0.14, fy - 2 * u);
        ctx.quadraticCurveTo(fx - t * 0.1, fy - t * 0.2 * flick, fx, fy - t * 0.3 * flick);
        ctx.quadraticCurveTo(fx + t * 0.1, fy - t * 0.2 * flick, fx + t * 0.14, fy - 2 * u);
        ctx.closePath();
        ctx.fillStyle = '#ff9a3c';
        ctx.fill();
        ctx.beginPath();
        ctx.ellipse(fx, fy - t * 0.08, t * 0.06, t * 0.1 * flick, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#ffe08a';
        ctx.fill();
      }
      for (let i = 0; i < n; i++) {
        const sx = top.x + (top.w / n) * (i + 0.5);
        const sy = top.y + top.h * 0.72;
        drawSteamer(ctx, sx, sy, t * 0.4, 2 + (i % 2));
        steam(ctx, sx, sy - t * 0.7, t, time, seed + i);
      }
      break;
    }
    case 'table': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.42, '#dcb984', '#a97c48');
      const slots = Math.max(1, Math.round(prop.w * 1.2));
      for (let i = 0; i < slots; i++) {
        const ix = top.x + (top.w / slots) * (i + 0.5);
        const iy = top.y + top.h * (prop.h > 1 ? 0.3 + 0.4 * (i % 2) : 0.5);
        if (prop.top === 'steamers') drawSteamer(ctx, ix, iy + t * 0.14, t * 0.2, 1 + (i % 2));
        else if (prop.top === 'bowls_green') {
          if (i % 2 === 0) bowl(ctx, ix, iy, t * 0.2, ZUNDA);
          else zundaMochi(ctx, ix, iy, t * 0.15);
        } else if (prop.top === 'bowls_red') bowl(ctx, ix, iy, t * 0.2, '#7a2f3a');
        else if (prop.top === 'mochi') {
          ctx.beginPath();
          ctx.ellipse(ix, iy, t * 0.17, t * 0.12, 0, 0, Math.PI * 2);
          ctx.fillStyle = MOCHI;
          ctx.fill();
          ink(ctx, 1.8 * u);
        } else if (prop.top === 'boxes') {
          roundRect(ctx, ix - t * 0.17, iy - t * 0.13, t * 0.34, t * 0.26, 3 * u);
          ctx.fillStyle = i % 2 === 0 ? '#f4ead2' : '#cfe3b0';
          ctx.fill();
          ink(ctx, 1.8 * u);
          ctx.fillStyle = '#c0392b';
          ctx.fillRect(ix - 1.5 * u, iy - t * 0.13, 3 * u, t * 0.26);
        } else {
          // 布をかけた台
          roundRect(ctx, ix - t * 0.2, iy - t * 0.12, t * 0.4, t * 0.24, 4 * u);
          ctx.fillStyle = '#fdf8ea';
          ctx.fill();
          ink(ctx, 1.6 * u);
        }
      }
      break;
    }
    case 'woodpile': {
      shadow(ctx, px, py, pw, ph, t);
      const r = t * 0.17;
      const cols = Math.floor((pw - t * 0.1) / (r * 2));
      const rowsCount = Math.round(prop.h * 1.5) + 1;
      const base = py + ph - t * 0.1 - r;
      for (let row = 0; row < rowsCount; row++) {
        const count = cols - (row % 2);
        for (let i = 0; i < count; i++) log(ctx, px + pw / 2 + (i - (count - 1) / 2) * r * 2, base - row * r * 1.72, r);
      }
      break;
    }
    case 'stump': {
      shadow(ctx, px, py, pw, ph, t);
      roundRect(ctx, cx - t * 0.3, py + ph * 0.4, t * 0.6, ph * 0.5, 5 * u);
      ctx.fillStyle = '#9a6a3c';
      ctx.fill();
      ink(ctx, 2.2 * u);
      ctx.beginPath();
      ctx.ellipse(cx, py + ph * 0.4, t * 0.3, t * 0.14, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#d2a56c';
      ctx.fill();
      ink(ctx, 2.2 * u);
      // 刺さった斧
      ctx.strokeStyle = '#7a5230';
      ctx.lineWidth = 5 * u;
      ctx.beginPath();
      ctx.moveTo(cx + t * 0.04, py + ph * 0.36);
      ctx.lineTo(cx + t * 0.34, py - t * 0.16);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.1, py + ph * 0.38);
      ctx.lineTo(cx + t * 0.02, py + ph * 0.12);
      ctx.lineTo(cx + t * 0.16, py + ph * 0.3);
      ctx.closePath();
      ctx.fillStyle = '#b9c0c8';
      ctx.fill();
      ink(ctx, 2 * u);
      break;
    }
    case 'lowtable': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.2, '#b87a48', '#8a5630', 0.16);
      zundaMochi(ctx, top.x + top.w * 0.36, top.y + top.h * 0.5, t * 0.17);
      zundaMochi(ctx, top.x + top.w * 0.52, top.y + top.h * 0.42, t * 0.17);
      roundRect(ctx, top.x + top.w * 0.72, top.y + top.h * 0.36, t * 0.22, t * 0.22, 4 * u);
      ctx.fillStyle = '#5f8fae';
      ctx.fill();
      ink(ctx, 1.8 * u);
      steam(ctx, top.x + top.w * 0.72 + t * 0.11, top.y + top.h * 0.36, t * 0.6, time, seed, 0.8);
      break;
    }
    case 'cabinet': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.75, '#8a5a36', '#6e4526');
      const fy = top.y + top.h;
      const fh = py + ph - t * 0.07 - fy;
      ctx.strokeStyle = 'rgba(40, 22, 8, 0.7)';
      ctx.lineWidth = 2 * u;
      const drawers = Math.max(2, prop.w);
      for (let i = 1; i < drawers; i++) {
        ctx.beginPath();
        ctx.moveTo(top.x + (top.w / drawers) * i, fy);
        ctx.lineTo(top.x + (top.w / drawers) * i, fy + fh);
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(top.x, fy + fh / 2);
      ctx.lineTo(top.x + top.w, fy + fh / 2);
      ctx.stroke();
      ctx.fillStyle = '#e0a93a';
      for (let i = 0; i < drawers; i++) {
        for (const k of [0.25, 0.75]) {
          ctx.beginPath();
          ctx.arc(top.x + (top.w / drawers) * (i + 0.5), fy + fh * k, 3 * u, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      break;
    }
    case 'shelf': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.95, '#8a5a36', '#5a3619', 0.04);
      const fy = top.y + top.h;
      const fh = py + ph - t * 0.07 - fy;
      ctx.fillStyle = '#7a4e2c';
      ctx.fillRect(top.x + 3 * u, fy + fh * 0.48, top.w - 6 * u, 4 * u);
      const slots = prop.w * 2;
      for (let row = 0; row < 2; row++) {
        for (let i = 0; i < slots; i++) {
          const ix = top.x + (top.w / slots) * (i + 0.5);
          const iy = fy + fh * (row === 0 ? 0.46 : 0.96);
          const pick = rand(seed * 9 + row * 5 + i);
          if (pick < 0.4) {
            roundRect(ctx, ix - t * 0.13, iy - t * 0.26, t * 0.26, t * 0.26, 5 * u);
            ctx.fillStyle = '#efe4c4';
          } else if (pick < 0.75) {
            ctx.beginPath();
            ctx.rect(ix - t * 0.13, iy - t * 0.22, t * 0.26, t * 0.22);
            ctx.fillStyle = '#c9975a';
          } else {
            ctx.beginPath();
            ctx.arc(ix, iy - t * 0.12, t * 0.12, 0, Math.PI * 2);
            ctx.fillStyle = ZUNDA;
          }
          ctx.fill();
          ink(ctx, 1.6 * u);
        }
      }
      break;
    }
    case 'crate': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.55, '#d0a468', '#a97c48', 0.04);
      ctx.strokeStyle = 'rgba(90, 54, 25, 0.75)';
      ctx.lineWidth = 2.2 * u;
      const fy = top.y + top.h;
      const fh = py + ph - t * 0.07 - fy;
      for (let i = 1; i < prop.w * 2; i++) {
        ctx.beginPath();
        ctx.moveTo(top.x + (top.w / (prop.w * 2)) * i, fy);
        ctx.lineTo(top.x + (top.w / (prop.w * 2)) * i, fy + fh);
        ctx.stroke();
      }
      // 上に載せた小さい箱
      const small = boxy(ctx, px + pw * 0.14, py + ph * 0.02 - t * 0.5, pw * 0.56, ph * 0.5, t, 0.34, '#dcb984', '#b58a54', 0.04);
      ctx.fillStyle = ZUNDA_DARK;
      ctx.fillRect(small.x + small.w * 0.36, small.y + small.h, small.w * 0.28, t * 0.2);
      break;
    }
    case 'bales': {
      shadow(ctx, px, py, pw, ph, t);
      const r = Math.min(pw / (prop.w * 2), t * 0.48);
      const base = py + ph - t * 0.1 - r * 0.86;
      const bale = (bx: number, by: number) => {
        roundRect(ctx, bx - r, by - r * 0.86, r * 2, r * 1.72, r * 0.7);
        ctx.fillStyle = '#dcb95e';
        ctx.fill();
        ink(ctx, 2.4 * u);
        ctx.strokeStyle = 'rgba(122, 82, 48, 0.8)';
        ctx.lineWidth = 2.4 * u;
        for (const k of [-0.45, 0, 0.45]) {
          ctx.beginPath();
          ctx.moveTo(bx + k * r, by - r * 0.82);
          ctx.lineTo(bx + k * r, by + r * 0.82);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.arc(bx, by, r * 0.24, 0, Math.PI * 2);
        ctx.fillStyle = '#b9923f';
        ctx.fill();
      };
      for (let i = 0; i < prop.w; i++) bale(px + (i + 0.5) * (pw / prop.w), base);
      for (let i = 0; i < prop.w - 1; i++) bale(px + (i + 1) * (pw / prop.w), base - r * 1.4);
      break;
    }
    case 'ice': {
      ctx.fillStyle = 'rgba(214, 190, 150, 0.7)';
      ctx.beginPath();
      ctx.ellipse(cx, py + ph - t * 0.1, pw * 0.5, t * 0.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 0.92;
      const top = boxy(ctx, px, py, pw, ph, t, 0.6, '#e6f5fc', '#b5dcee', 0.06);
      ctx.globalAlpha = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.lineWidth = 4 * u;
      ctx.beginPath();
      ctx.moveTo(top.x + top.w * 0.16, top.y + top.h * 0.7);
      ctx.lineTo(top.x + top.w * 0.42, top.y + top.h * 0.2);
      ctx.moveTo(top.x + top.w * 0.34, top.y + top.h * 0.78);
      ctx.lineTo(top.x + top.w * 0.5, top.y + top.h * 0.46);
      ctx.stroke();
      break;
    }
    case 'usu': {
      shadow(ctx, px, py, pw, ph, t);
      const top = py + ph * 0.34;
      const bottom = py + ph - t * 0.1;
      ctx.beginPath();
      ctx.moveTo(cx - pw * 0.4, top);
      ctx.quadraticCurveTo(cx - pw * 0.22, (top + bottom) / 2, cx - pw * 0.34, bottom);
      ctx.lineTo(cx + pw * 0.34, bottom);
      ctx.quadraticCurveTo(cx + pw * 0.22, (top + bottom) / 2, cx + pw * 0.4, top);
      ctx.closePath();
      ctx.fillStyle = '#a9743f';
      ctx.fill();
      ink(ctx, 2.6 * u);
      ctx.beginPath();
      ctx.ellipse(cx, top, pw * 0.4, ph * 0.17, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#c69256';
      ctx.fill();
      ink(ctx, 2.6 * u);
      ctx.beginPath();
      ctx.ellipse(cx, top + ph * 0.01, pw * 0.28, ph * 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = MOCHI;
      ctx.fill();
      ink(ctx, 2 * u);
      // 立てかけた杵
      ctx.strokeStyle = '#8a5a36';
      ctx.lineWidth = 7 * u;
      ctx.beginPath();
      ctx.moveTo(cx + pw * 0.46, bottom);
      ctx.lineTo(cx + pw * 0.2, py - t * 0.2);
      ctx.stroke();
      ctx.save();
      ctx.translate(cx + pw * 0.2, py - t * 0.2);
      ctx.rotate(-0.3);
      roundRect(ctx, -t * 0.34, -t * 0.14, t * 0.68, t * 0.28, 6 * u);
      ctx.fillStyle = '#d2a56c';
      ctx.fill();
      ink(ctx, 2.4 * u);
      ctx.restore();
      break;
    }
    case 'pots': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.34, '#c9a889', '#a8825f', 0.1);
      const n = Math.max(1, Math.floor(prop.w / 2));
      for (let i = 0; i < n; i++) {
        const ox = top.x + (top.w / n) * (i + 0.5);
        const oy = top.y + top.h * 0.42;
        ctx.beginPath();
        ctx.ellipse(ox, oy, t * 0.56, t * 0.3, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#3a3a40';
        ctx.fill();
        ink(ctx, 2.6 * u);
        ctx.beginPath();
        ctx.ellipse(ox, oy - t * 0.03, t * 0.44, t * 0.21, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#7a2f3a';
        ctx.fill();
        steam(ctx, ox, oy - t * 0.1, t, time, seed + i);
      }
      break;
    }
    case 'bell': {
      // 鐘つき堂（石の台、柱、屋根、鐘）
      const base = boxy(ctx, px, py, pw, ph, t, 0.16, '#cfc9bc', '#a8a294', 0.06);
      const floorY = base.y + base.h * 0.8;
      const roofY = py - t * 1.25;
      ctx.fillStyle = '#8a5a36';
      for (const k of [0.14, 0.86]) {
        ctx.beginPath();
        ctx.rect(px + pw * k - 5 * u, roofY, 10 * u, floorY - roofY);
        ctx.fill();
        ink(ctx, 2.2 * u);
      }
      ctx.fillRect(px + pw * 0.1, roofY + t * 0.22, pw * 0.8, 7 * u);
      drawBell(ctx, cx, roofY + t * 0.98, t * 0.4, Math.sin(time * 1.3 + seed) * 0.06);
      ctx.beginPath();
      ctx.moveTo(px - t * 0.2, roofY + t * 0.12);
      ctx.quadraticCurveTo(cx, roofY - t * 0.5, cx, roofY - t * 0.62);
      ctx.quadraticCurveTo(cx, roofY - t * 0.5, px + pw + t * 0.2, roofY + t * 0.12);
      ctx.closePath();
      ctx.fillStyle = '#4c5563';
      ctx.fill();
      ink(ctx, 2.8 * u);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 2 * u;
      for (const k of [0.25, 0.5, 0.75]) {
        ctx.beginPath();
        ctx.moveTo(px + pw * k, roofY + t * 0.1);
        ctx.lineTo(cx + (px + pw * k - cx) * 0.3, roofY - t * 0.4);
        ctx.stroke();
      }
      break;
    }
    case 'well': {
      shadow(ctx, px, py, pw, ph, t);
      const wy = py + ph * 0.56;
      roundRect(ctx, cx - pw * 0.4, wy, pw * 0.8, ph * 0.36, 8 * u);
      ctx.fillStyle = '#a8a294';
      ctx.fill();
      ink(ctx, 2.6 * u);
      ctx.beginPath();
      ctx.ellipse(cx, wy, pw * 0.4, ph * 0.16, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#cfc9bc';
      ctx.fill();
      ink(ctx, 2.6 * u);
      ctx.beginPath();
      ctx.ellipse(cx, wy, pw * 0.28, ph * 0.1, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#27404f';
      ctx.fill();
      ink(ctx, 2 * u);
      ctx.strokeStyle = '#8a5a36';
      ctx.lineWidth = 7 * u;
      ctx.beginPath();
      ctx.moveTo(cx - pw * 0.4, wy);
      ctx.lineTo(cx - pw * 0.4, py - t * 0.5);
      ctx.moveTo(cx + pw * 0.4, wy);
      ctx.lineTo(cx + pw * 0.4, py - t * 0.5);
      ctx.moveTo(cx - pw * 0.5, py - t * 0.5);
      ctx.lineTo(cx + pw * 0.5, py - t * 0.5);
      ctx.stroke();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6 * u;
      ctx.beginPath();
      ctx.moveTo(cx, py - t * 0.5);
      ctx.lineTo(cx, py + ph * 0.1);
      ctx.stroke();
      roundRect(ctx, cx - t * 0.14, py + ph * 0.1, t * 0.28, t * 0.24, 3 * u);
      ctx.fillStyle = '#c99a58';
      ctx.fill();
      ink(ctx, 1.8 * u);
      break;
    }
    case 'pine': {
      shadow(ctx, px, py, pw, ph, t);
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.14, py + ph - t * 0.12);
      ctx.quadraticCurveTo(cx - t * 0.3, py + ph * 0.3, cx - t * 0.02, py - t * 0.5);
      ctx.lineTo(cx + t * 0.2, py - t * 0.5);
      ctx.quadraticCurveTo(cx - t * 0.02, py + ph * 0.3, cx + t * 0.16, py + ph - t * 0.12);
      ctx.closePath();
      ctx.fillStyle = '#7a5230';
      ctx.fill();
      ink(ctx, 2.6 * u);
      const sway = Math.sin(time * 0.8 + seed) * t * 0.015;
      for (const [dx, dy, rx] of [[-0.5, -0.2, 0.6], [0.5, -0.5, 0.62], [-0.1, -1.0, 0.7], [0.36, -1.4, 0.5]] as const) {
        ctx.beginPath();
        ctx.ellipse(cx + dx * t + sway, py + dy * t, rx * t, rx * t * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#3f7a4a';
        ctx.fill();
        ink(ctx, 2.6 * u);
        ctx.beginPath();
        ctx.ellipse(cx + dx * t + sway, py + dy * t - rx * t * 0.14, rx * t * 0.7, rx * t * 0.24, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#5a9a5e';
        ctx.fill();
      }
      break;
    }
    case 'stonelamp': {
      shadow(ctx, px, py, pw, ph, t);
      const base = py + ph - t * 0.1;
      ctx.fillStyle = '#b5af9f';
      roundRect(ctx, cx - t * 0.3, base - t * 0.16, t * 0.6, t * 0.16, 3 * u);
      ctx.fill();
      ink(ctx, 2.2 * u);
      ctx.beginPath();
      ctx.rect(cx - t * 0.09, base - t * 0.72, t * 0.18, t * 0.56);
      ctx.fill();
      ink(ctx, 2.2 * u);
      roundRect(ctx, cx - t * 0.24, base - t * 1.06, t * 0.48, t * 0.36, 3 * u);
      ctx.fill();
      ink(ctx, 2.2 * u);
      roundRect(ctx, cx - t * 0.13, base - t * 0.98, t * 0.26, t * 0.2, 2 * u);
      ctx.fillStyle = `rgba(255, 214, 120, ${0.85 + 0.12 * Math.sin(time * 3 + seed)})`;
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.36, base - t * 1.04);
      ctx.lineTo(cx, base - t * 1.36);
      ctx.lineTo(cx + t * 0.36, base - t * 1.04);
      ctx.closePath();
      ctx.fillStyle = '#9a958a';
      ctx.fill();
      ink(ctx, 2.2 * u);
      break;
    }
    case 'pond': {
      roundRect(ctx, px + t * 0.06, py + t * 0.1, pw - t * 0.12, ph - t * 0.2, t * 0.7);
      ctx.fillStyle = '#a8a294';
      ctx.fill();
      ink(ctx, 2.6 * u);
      roundRect(ctx, px + t * 0.2, py + t * 0.24, pw - t * 0.4, ph - t * 0.48, t * 0.56);
      ctx.fillStyle = '#6fb6d2';
      ctx.fill();
      ink(ctx, 2 * u);
      for (let i = 0; i < 2; i++) {
        const k = time * 0.25 + i * 3.1 + seed;
        const fx = cx + Math.cos(k) * pw * 0.24;
        const fy = py + ph / 2 + Math.sin(k * 1.3) * ph * 0.14;
        ctx.save();
        ctx.translate(fx, fy);
        ctx.rotate(Math.atan2(Math.cos(k * 1.3) * 1.3 * ph * 0.14, -Math.sin(k) * pw * 0.24));
        ctx.beginPath();
        ctx.ellipse(0, 0, t * 0.16, t * 0.07, 0, 0, Math.PI * 2);
        ctx.moveTo(-t * 0.14, 0);
        ctx.lineTo(-t * 0.26, -t * 0.08);
        ctx.lineTo(-t * 0.26, t * 0.08);
        ctx.closePath();
        ctx.fillStyle = i === 0 ? '#f08a3c' : '#fdf3e0';
        ctx.fill();
        ctx.restore();
      }
      break;
    }
    case 'desk': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.28, '#b87a48', '#8a5630');
      roundRect(ctx, top.x + top.w * 0.12, top.y + top.h * 0.2, top.w * 0.3, top.h * 0.6, 2 * u);
      ctx.fillStyle = '#fdf8ea';
      ctx.fill();
      ink(ctx, 1.6 * u);
      roundRect(ctx, top.x + top.w * 0.54, top.y + top.h * 0.28, top.w * 0.34, top.h * 0.44, 2 * u);
      ctx.fillStyle = '#6e4526';
      ctx.fill();
      ink(ctx, 1.6 * u);
      ctx.fillStyle = '#e0a93a';
      for (let i = 0; i < 5; i++) {
        ctx.beginPath();
        ctx.arc(top.x + top.w * (0.59 + i * 0.06), top.y + top.h * 0.5, 2.6 * u, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case 'counter': {
      const top = boxy(ctx, px, py, pw, ph, t, 0.55, '#e2c08a', '#9c6b3a');
      roundRect(ctx, top.x + t * 0.3, top.y + top.h * 0.14, top.w - t * 0.6, top.h * 0.72, 4 * u);
      ctx.fillStyle = '#b8322a';
      ctx.fill();
      ink(ctx, 1.8 * u);
      for (let i = 0; i < prop.w; i++) {
        const ix = top.x + (top.w / prop.w) * (i + 0.5);
        if (i % 3 === 1) bowl(ctx, ix, top.y + top.h * 0.5, t * 0.19, ZUNDA);
        else zundaMochi(ctx, ix, top.y + top.h * 0.5, t * 0.17);
      }
      break;
    }
    case 'display': {
      // 2段の陳列台
      const low = boxy(ctx, px, py + ph * 0.5, pw, ph * 0.5, t, 0.3, '#c8382e', '#8f2019');
      const high = boxy(ctx, px, py, pw, ph * 0.5, t, 0.62, '#c8382e', '#8f2019');
      for (const [face, n] of [[high, prop.w], [low, prop.w]] as const) {
        for (let i = 0; i < n; i++) {
          const ix = face.x + (face.w / n) * (i + 0.5);
          roundRect(ctx, ix - t * 0.19, face.y + face.h * 0.5 - t * 0.12, t * 0.38, t * 0.24, 3 * u);
          ctx.fillStyle = '#f4ead2';
          ctx.fill();
          ink(ctx, 1.6 * u);
          ctx.beginPath();
          ctx.arc(ix, face.y + face.h * 0.5, t * 0.07, 0, Math.PI * 2);
          ctx.fillStyle = ZUNDA;
          ctx.fill();
        }
      }
      break;
    }
    case 'breaker': {
      // ブレーカー（壁の配電盤。レバーを上げると、あかりが戻る）
      shadow(ctx, px, py, pw, ph, t);
      const bx = cx - t * 0.3;
      const by = py + ph * 0.86 - t * 0.78;
      roundRect(ctx, bx, by, t * 0.6, t * 0.78, 5 * u);
      ctx.fillStyle = '#8d97a3';
      ctx.fill();
      ink(ctx, 2.4 * u);
      roundRect(ctx, bx + t * 0.07, by + t * 0.07, t * 0.46, t * 0.46, 3 * u);
      ctx.fillStyle = '#56606b';
      ctx.fill();
      ink(ctx, 1.6 * u);
      // レバー（上がっている）
      roundRect(ctx, cx - t * 0.06, by + t * 0.12, t * 0.12, t * 0.3, 3 * u);
      ctx.fillStyle = '#e8ecef';
      ctx.fill();
      ink(ctx, 1.6 * u);
      roundRect(ctx, cx - t * 0.11, by + t * 0.1, t * 0.22, t * 0.1, 3 * u);
      ctx.fillStyle = '#d6452f';
      ctx.fill();
      ink(ctx, 1.6 * u);
      // 稲妻の札
      ctx.beginPath();
      ctx.moveTo(cx + t * 0.03, by + t * 0.57);
      ctx.lineTo(cx - t * 0.07, by + t * 0.68);
      ctx.lineTo(cx, by + t * 0.68);
      ctx.lineTo(cx - t * 0.03, by + t * 0.76);
      ctx.lineTo(cx + t * 0.08, by + t * 0.64);
      ctx.lineTo(cx + t * 0.01, by + t * 0.64);
      ctx.closePath();
      ctx.fillStyle = '#f2c230';
      ctx.fill();
      ink(ctx, 1.2 * u);
      break;
    }
    case 'jar': {
      // 油つぼ（2026-11-18 までの地図。あかりの油を入れてある、ふたつきの壺）
      shadow(ctx, px, py, pw, ph, t);
      const by = py + ph * 0.86;
      ctx.beginPath();
      ctx.moveTo(cx - t * 0.16, by - t * 0.62);
      ctx.bezierCurveTo(cx - t * 0.46, by - t * 0.52, cx - t * 0.42, by - t * 0.04, cx - t * 0.2, by);
      ctx.lineTo(cx + t * 0.2, by);
      ctx.bezierCurveTo(cx + t * 0.42, by - t * 0.04, cx + t * 0.46, by - t * 0.52, cx + t * 0.16, by - t * 0.62);
      ctx.closePath();
      ctx.fillStyle = '#7a4a2a';
      ctx.fill();
      ink(ctx, 2.4 * u);
      // うわぐすりのつや
      ctx.beginPath();
      ctx.ellipse(cx - t * 0.2, by - t * 0.36, t * 0.05, t * 0.14, 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 230, 190, 0.5)';
      ctx.fill();
      // 口と、木のふた
      ctx.beginPath();
      ctx.ellipse(cx, by - t * 0.62, t * 0.19, t * 0.07, 0, 0, Math.PI * 2);
      ctx.fillStyle = '#c99a58';
      ctx.fill();
      ink(ctx, 2.2 * u);
      roundRect(ctx, cx - t * 0.05, by - t * 0.74, t * 0.1, t * 0.09, 2 * u);
      ctx.fillStyle = '#8a5a36';
      ctx.fill();
      ink(ctx, 1.8 * u);
      // 「油」の札
      roundRect(ctx, cx - t * 0.13, by - t * 0.4, t * 0.26, t * 0.26, 3 * u);
      ctx.fillStyle = '#f6ecd2';
      ctx.fill();
      ink(ctx, 1.6 * u);
      ctx.font = `800 ${t * 0.2}px "Hiragino Maru Gothic ProN", system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = INK;
      ctx.fillText('油', cx, by - t * 0.265);
      break;
    }
    case 'bench': {
      boxy(ctx, px, py, pw, ph, t, 0.32, '#c8382e', '#8f2019', 0.05);
      ctx.fillStyle = '#6e4526';
      for (const k of [0.1, 0.9]) ctx.fillRect(px + pw * k - 4 * u, py + ph - t * 0.2, 8 * u, t * 0.14);
      break;
    }
    case 'conveyor': {
      // ベルトコンベアー（包んだ餅を、箱の山の方へ運ぶ）。ベルトの筋と、載っている餅が、左から右へ流れる
      const top = boxy(ctx, px, py, pw, ph, t, 0.42, '#4b4f57', '#8a8f99', 0.06);
      const fy = top.y + top.h;
      // 脚と、両はしのローラー
      ctx.fillStyle = '#5d636d';
      for (const k of [0.08, 0.5, 0.92]) ctx.fillRect(top.x + top.w * k - 3 * u, fy + t * 0.12, 6 * u, py + ph - fy - t * 0.16);
      for (const rx of [top.x + t * 0.12, top.x + top.w - t * 0.12]) {
        ctx.beginPath();
        ctx.arc(rx, fy + t * 0.1, t * 0.1, 0, Math.PI * 2);
        ctx.fillStyle = '#c3c8cf';
        ctx.fill();
        ink(ctx, 1.8 * u);
      }
      ctx.save();
      ctx.beginPath();
      ctx.rect(top.x + 2 * u, top.y + 2 * u, top.w - 4 * u, top.h - 4 * u);
      ctx.clip();
      // ベルトの筋
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
      ctx.lineWidth = 3 * u;
      const gap = t * 0.32;
      const shift = (time * t * 0.7) % gap;
      for (let x = top.x - gap + shift; x < top.x + top.w + gap; x += gap) {
        ctx.beginPath();
        ctx.moveTo(x, top.y);
        ctx.lineTo(x, top.y + top.h);
        ctx.stroke();
      }
      // 運ばれていく餅
      const lane = top.w + t * 0.6;
      for (let i = 0; i < prop.w; i++) {
        const x = top.x - t * 0.3 + ((time * t * 0.7 + (lane / prop.w) * i) % lane);
        zundaMochi(ctx, x, top.y + top.h * 0.5, t * 0.15);
      }
      ctx.restore();
      // 右はしの、動かす箱（緑のランプ）
      const bx = top.x + top.w - t * 0.3;
      roundRect(ctx, bx, top.y - t * 0.34, t * 0.26, t * 0.3, 4 * u);
      ctx.fillStyle = '#e6c84a';
      ctx.fill();
      ink(ctx, 1.8 * u);
      ctx.beginPath();
      ctx.arc(bx + t * 0.13, top.y - t * 0.19, t * 0.06, 0, Math.PI * 2);
      ctx.fillStyle = Math.sin(time * 5) > -0.2 ? '#6fd36a' : '#2f7a2c';
      ctx.fill();
      break;
    }
    case 'panel': {
      // 壁の配電盤（ふたの窓から、赤・青・黄の配線が見える）。top: 'fuse' は、ヒューズが並ぶ箱
      const top = boxy(ctx, px + pw * 0.1, py, pw * 0.8, ph * 0.9, t, 0.85, '#a3acb6', '#7b8591', 0.06);
      const fy = top.y + top.h;
      const fh = py + ph * 0.9 - t * 0.07 - fy;
      roundRect(ctx, top.x + t * 0.08, fy + fh * 0.12, top.w - t * 0.16, fh * 0.62, 3 * u);
      ctx.fillStyle = '#2d3138';
      ctx.fill();
      ink(ctx, 1.6 * u);
      const wx = top.x + t * 0.08;
      const ww = top.w - t * 0.16;
      const wy = fy + fh * 0.12;
      const wh = fh * 0.62;
      if (prop.top === 'fuse') {
        for (let i = 0; i < 3; i++) {
          roundRect(ctx, wx + (ww / 3) * i + ww * 0.06, wy + wh * 0.2, ww * 0.2, wh * 0.6, 3 * u);
          ctx.fillStyle = i === 1 ? '#f3d36b' : '#e8e2d4';
          ctx.fill();
          ink(ctx, 1.2 * u);
        }
      } else {
        ctx.lineWidth = 3 * u;
        (['#e2483b', '#3f7fe0', '#f0c23c'] as const).forEach((color, i) => {
          ctx.beginPath();
          ctx.moveTo(wx + ww * 0.12, wy + wh * (0.25 + i * 0.25));
          ctx.bezierCurveTo(wx + ww * 0.45, wy + wh * (0.25 + ((i + 1) % 3) * 0.25), wx + ww * 0.55, wy + wh * (0.25 + ((i + 2) % 3) * 0.25), wx + ww * 0.88, wy + wh * (0.25 + ((i + 1) % 3) * 0.25));
          ctx.strokeStyle = color;
          ctx.stroke();
        });
      }
      // かみなりの印（黄色い三角）
      const ty = top.y + top.h * 0.5;
      ctx.beginPath();
      ctx.moveTo(cx, ty - t * 0.12);
      ctx.lineTo(cx + t * 0.12, ty + t * 0.09);
      ctx.lineTo(cx - t * 0.12, ty + t * 0.09);
      ctx.closePath();
      ctx.fillStyle = '#f3d03b';
      ctx.fill();
      ink(ctx, 1.4 * u);
      ctx.beginPath();
      ctx.moveTo(cx + t * 0.01, ty - t * 0.06);
      ctx.lineTo(cx - t * 0.03, ty + t * 0.02);
      ctx.lineTo(cx + t * 0.02, ty + t * 0.02);
      ctx.lineTo(cx - t * 0.01, ty + t * 0.07);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 1.6 * u;
      ctx.stroke();
      break;
    }
    case 'generator': {
      // 発電機（はずみ車が回り、煙突から湯気が出る。目盛りの針がゆれる）
      const top = boxy(ctx, px, py + ph * 0.1, pw, ph * 0.9, t, 0.72, '#4f8a69', '#356b4f', 0.1);
      const fy = top.y + top.h;
      const fh = py + ph - t * 0.07 - fy;
      // 横の、はずみ車
      const wx = top.x + top.w * 0.2;
      const wy = top.y + top.h * 0.5;
      const wr = Math.min(top.h * 0.42, t * 0.5);
      ctx.beginPath();
      ctx.arc(wx, wy, wr, 0, Math.PI * 2);
      ctx.fillStyle = '#c3c8cf';
      ctx.fill();
      ink(ctx, 2.2 * u);
      ctx.save();
      ctx.translate(wx, wy);
      ctx.rotate(time * 4);
      ctx.strokeStyle = '#5d636d';
      ctx.lineWidth = 3 * u;
      for (let i = 0; i < 3; i++) {
        ctx.rotate((Math.PI * 2) / 3);
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(wr * 0.85, 0);
        ctx.stroke();
      }
      ctx.restore();
      // 目盛り
      const gx = top.x + top.w * 0.62;
      const gy = top.y + top.h * 0.5;
      ctx.beginPath();
      ctx.arc(gx, gy, t * 0.2, 0, Math.PI * 2);
      ctx.fillStyle = '#f6f1e2';
      ctx.fill();
      ink(ctx, 1.8 * u);
      const needle = -Math.PI * 0.75 + (0.55 + Math.sin(time * 1.7 + seed) * 0.12) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(gx, gy);
      ctx.lineTo(gx + Math.cos(needle) * t * 0.16, gy + Math.sin(needle) * t * 0.16);
      ctx.strokeStyle = '#c0392b';
      ctx.lineWidth = 2 * u;
      ctx.stroke();
      // 煙突
      const sx = top.x + top.w * 0.86;
      roundRect(ctx, sx - t * 0.09, top.y - t * 0.45, t * 0.18, t * 0.5, 3 * u);
      ctx.fillStyle = '#5d636d';
      ctx.fill();
      ink(ctx, 1.8 * u);
      steam(ctx, sx, top.y - t * 0.45, t * 0.8, time, seed, 0.9);
      // 手前の面の、通気の筋
      ctx.strokeStyle = 'rgba(20, 50, 34, 0.55)';
      ctx.lineWidth = 2 * u;
      for (let i = 1; i < 6; i++) {
        ctx.beginPath();
        ctx.moveTo(top.x + (top.w / 6) * i, fy + fh * 0.2);
        ctx.lineTo(top.x + (top.w / 6) * i, fy + fh * 0.8);
        ctx.stroke();
      }
      break;
    }
    case 'chair': {
      // 店先の、木の椅子（背もたれつき）
      shadow(ctx, px + pw * 0.15, py + ph * 0.2, pw * 0.7, ph * 0.8, t);
      ctx.fillStyle = '#7a4e2c';
      for (const k of [0.26, 0.74]) ctx.fillRect(px + pw * k - 3 * u, py + ph * 0.62, 6 * u, ph * 0.3);
      roundRect(ctx, px + pw * 0.2, py + ph * 0.08, pw * 0.6, ph * 0.42, 6 * u);
      ctx.fillStyle = '#b07a46';
      ctx.fill();
      ink(ctx, 2.2 * u);
      ctx.fillStyle = 'rgba(255, 235, 200, 0.35)';
      ctx.fillRect(px + pw * 0.28, py + ph * 0.16, pw * 0.44, 3 * u);
      roundRect(ctx, px + pw * 0.16, py + ph * 0.46, pw * 0.68, ph * 0.22, 5 * u);
      ctx.fillStyle = '#c98f55';
      ctx.fill();
      ink(ctx, 2.2 * u);
      break;
    }
    case 'broom': {
      // 壁に立てかけた、ほうきと、ちりとり
      shadow(ctx, px, py + ph * 0.3, pw, ph * 0.7, t);
      ctx.beginPath();
      ctx.moveTo(px + pw * 0.66, py + ph * 0.02);
      ctx.lineTo(px + pw * 0.4, py + ph * 0.66);
      ctx.strokeStyle = '#8a5a36';
      ctx.lineWidth = 5 * u;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(px + pw * 0.3, py + ph * 0.6);
      ctx.lineTo(px + pw * 0.52, py + ph * 0.66);
      ctx.lineTo(px + pw * 0.46, py + ph * 0.94);
      ctx.lineTo(px + pw * 0.14, py + ph * 0.88);
      ctx.closePath();
      ctx.fillStyle = '#d9b75a';
      ctx.fill();
      ink(ctx, 2 * u);
      roundRect(ctx, px + pw * 0.56, py + ph * 0.7, pw * 0.36, ph * 0.22, 4 * u);
      ctx.fillStyle = '#5f8fae';
      ctx.fill();
      ink(ctx, 2 * u);
      break;
    }
    default: {
      boxy(ctx, px, py, pw, ph, t, 0.4, '#c9a889', '#a8825f');
    }
  }
  ctx.restore();
}
