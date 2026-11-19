// 台本ボットの試合を、ブラウザの中で回して上映する。AI は呼ばず、どこへも通信しない（静的なファイルだけで動く）。
//
//   ?seed=<数>     試合の種（同じ種なら、同じ試合になる。省くと、でたらめに選ぶ）
//   ?players=<数>  人数（5〜12。既定は11）
//   ?foxes=<数>    狐の人数（既定は0）
//   ?secrets=0     役職と内心を隠す
//   ?speed=2       速さ
//   ?sfx=0         音を出さない
//   ?cam=overview  見回りのあいだ、いつも工房の全体を映す

import workshop from '../../../content/maps/workshop.json' with { type: 'json' };
import { runMatch } from '../../server/src/run-match.ts';
import type { MapDefinition } from '../../sim/src/index.ts';
import { Stage } from './scenes.ts';
import { buildShow } from './show.ts';
import type { Show } from './show.ts';
import { scoreOf, Sound } from './sound.ts';
import { clockLabel, H, W } from './theme.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
const ui = {
  frame: $('frame'),
  play: $<HTMLButtonElement>('play'),
  clock: $('clock'),
  seek: $<HTMLInputElement>('seek'),
  speed: $<HTMLSelectElement>('speed'),
  secrets: $<HTMLInputElement>('secrets'),
  overview: $<HTMLInputElement>('overview'),
  sound: $<HTMLInputElement>('sound'),
  seed: $<HTMLInputElement>('seed'),
  again: $<HTMLButtonElement>('again'),
  fresh: $<HTMLButtonElement>('fresh'),
  note: $('note'),
  help: $<HTMLDialogElement>('help'),
  helpOpen: $<HTMLButtonElement>('help-open'),
};
const params = new URLSearchParams(location.search);
const sound = new Sound();

const clampInt = (value: string | null, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return value !== null && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const players = clampInt(params.get('players'), 5, 12, 11);
const foxes = clampInt(params.get('foxes'), 0, 1, 0);

let show: Show | null = null;
let stage: Stage | null = null;
let time = 0;
let playing = false;
let notice = '試合を作っています…';
let building = 0;

if (params.get('secrets') === '0') ui.secrets.checked = false;
if (params.get('sfx') === '0') ui.sound.checked = false;
if (params.get('cam') === 'overview') ui.overview.checked = true;
if (params.get('speed')) ui.speed.value = params.get('speed') as string;
sound.enabled = ui.sound.checked;

function fit(): void {
  const box = ui.frame.getBoundingClientRect();
  const scale = Math.min(box.width / W, box.height / H);
  canvas.style.width = `${Math.floor(W * scale)}px`;
  canvas.style.height = `${Math.floor(H * scale)}px`;
  const pixels = Math.min(2, Math.max(1, scale * devicePixelRatio));
  canvas.width = Math.round(W * pixels);
  canvas.height = Math.round(H * pixels);
}

const renderOptions = () => ({ secrets: ui.secrets.checked, credits: [], camera: ui.overview.checked ? ('overview' as const) : ('auto' as const) });
const totalTime = () => show?.total ?? 0;

function render(): void {
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / H, 0, 0);
  if (stage) {
    stage.draw(ctx, time, renderOptions());
  } else {
    ctx.fillStyle = '#f6ecd2';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#3b2a1e';
    ctx.font = '600 44px "Hiragino Maru Gothic ProN", "Hiragino Sans", "Noto Sans JP", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(notice, W / 2, H / 2);
  }
  if (show) {
    ui.clock.textContent = `${clockLabel(time)} / ${clockLabel(totalTime())}`;
    if (document.activeElement !== ui.seek) ui.seek.value = String(time);
  }
}

/** 再生が進んで、またいだ合図の音（効果音と、しゃべり声）を鳴らす。 */
function cross(from: number, to: number): void {
  if (!show) return;
  for (const item of scoreOf(show, { secrets: ui.secrets.checked, from, to, startsOnly: true })) {
    if ('effect' in item) sound.play(item.effect);
    else if ('blip' in item) sound.blip(item.blip);
  }
}

function setPlaying(next: boolean): void {
  playing = next && show !== null;
  ui.play.textContent = playing ? '一時停止' : '再生';
  if (playing) {
    sound.unlock();
    if (time >= totalTime() - 0.01) time = 0;
  }
}

let previous = performance.now();
function loop(now: number): void {
  // 上映の時計は、実際に過ぎた時間で進める。1秒より長く間が空いた時（別のタブを見ていた等）は、止まっていたものとして扱う
  const elapsed = (now - previous) / 1000;
  previous = now;
  if (playing && show) {
    const from = time;
    time = Math.min(totalTime(), time + (elapsed > 1 ? 0 : elapsed) * Number(ui.speed.value));
    cross(from, time);
    if (time >= totalTime()) setPlaying(false);
  }
  render();
  requestAnimationFrame(loop);
}

/** 種から試合を作って、上映を用意する。 */
async function open(seed: number, autoplay: boolean): Promise<void> {
  const mine = ++building;
  setPlaying(false);
  show = null;
  stage = null;
  time = 0;
  notice = '試合を作っています…';
  ui.seed.value = String(seed);
  ui.note.textContent = '';
  // 文字を描いてから、試合を回す（回している間は、画面が止まるため）
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  try {
    const log = await runMatch({ seed, map: workshop as unknown as MapDefinition, players, roam: { foxes }, brains: [null], denyList: [] });
    if (mine !== building) return;
    show = buildShow(log, null);
    stage = new Stage(show);
    ui.seek.max = String(totalTime());
    ui.note.textContent = `種 ${seed} ／ ${log.seats.length}人`;
    const url = new URL(location.href);
    url.searchParams.set('seed', String(seed));
    history.replaceState(null, '', url);
    document.title = `種 ${seed} — ずんだ餅工房のもちもち事件`;
    if (autoplay) setPlaying(true);
  } catch (error) {
    notice = `試合を作れませんでした: ${error instanceof Error ? error.message : String(error)}`;
  }
}

const randomSeed = () => 1 + Math.floor(Math.random() * 99999);

ui.play.addEventListener('click', () => setPlaying(!playing));
ui.seek.addEventListener('input', () => {
  time = Number(ui.seek.value);
});
ui.sound.addEventListener('change', () => {
  sound.enabled = ui.sound.checked;
});
ui.again.addEventListener('click', () => void open(clampInt(ui.seed.value, 1, 2 ** 31 - 1, randomSeed()), true));
ui.fresh.addEventListener('click', () => void open(randomSeed(), true));
ui.seed.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') void open(clampInt(ui.seed.value, 1, 2 ** 31 - 1, randomSeed()), true);
});
ui.helpOpen.addEventListener('click', () => ui.help.showModal());
addEventListener('resize', fit);
addEventListener('keydown', (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || ui.help.open || !show) return;
  if (event.code === 'Space') {
    event.preventDefault();
    setPlaying(!playing);
  } else if (event.code === 'ArrowRight' || event.code === 'ArrowLeft') {
    time = Math.min(totalTime(), Math.max(0, time + (event.code === 'ArrowRight' ? 5 : -5)));
  } else if (event.code === 'KeyS') {
    ui.secrets.checked = !ui.secrets.checked;
  } else if (event.code === 'KeyM') {
    ui.overview.checked = !ui.overview.checked;
  } else if (event.code === 'KeyH') {
    document.body.classList.toggle('clean');
    fit();
  }
});

fit();
requestAnimationFrame(loop);
void open(clampInt(params.get('seed'), 1, 2 ** 31 - 1, randomSeed()), false);
