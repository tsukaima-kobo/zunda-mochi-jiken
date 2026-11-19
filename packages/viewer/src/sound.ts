// 音。効果音はすべてこの場で合成する（音のファイルは持たない）。
// 発言の音声は、別に作っておいた音声ファイルがあれば、それを流す（この公開版には無いので、しゃべり声の音を鳴らす）。
// 音声は先に読み込んで解いておき（AudioBuffer）、合図の時刻ちょうどに鳴らす（口と字幕の時刻を、音声に合わせるため）。
//
// 書き出し（1コマずつ動画にする）の時は、同じ音を「音を先に作る仕組み」（OfflineAudioContext）に並べて、1本の音にする。
// どのできごとでどの音を鳴らすかは effectOf / scoreOf に1か所だけ書き、上映と書き出しで同じものを使う。

import { FIRED } from './show.ts';
import type { Cue, Show } from './show.ts';
import { rand } from './theme.ts';

export type Effect = 'bell' | 'nap' | 'cutin' | 'pon' | 'lightsOut' | 'alarm' | 'shut' | 'open' | 'relief' | 'creak' | 'flip' | 'thud' | 'stamp' | 'fanfareWin' | 'fanfareLose' | 'peek' | 'monitor';

/**
 * できごとで鳴らす効果音。役職を隠している時（secrets が false）は、音で役職や床下の人が分からないようにする。
 * 札を開く音（flip）は投票ごとに返すので、同じ時刻の投票では1回だけ鳴らす（呼ぶ側でまとめる）。
 */
export function effectOf(event: Cue['event'], secrets: boolean): Effect | null {
  switch (event.type) {
    case 'meeting_start':
      return 'bell';
    case 'nap':
      return 'nap';
    // ふりの仕込みは、役職を見せている時だけ無音にする（隠している時に、音で見分けがつかないように）
    case 'task':
      return !event.pretend || !secrets ? 'pon' : null;
    case 'sabotage':
      return event.what === 'lights' ? 'lightsOut' : event.what === 'crisis' ? 'alarm' : 'shut';
    case 'door_open':
      return 'open';
    case 'fixed':
      return 'relief';
    // 抜け道は、役職を見せている時だけ聞こえる（音で、床下にいることを明かさない）
    case 'sneak':
      return secrets ? 'creak' : null;
    // 工房の道具を見る（盤と名札かけは、木の札の音。防犯カメラの画面は、画面がつく音）
    case 'look':
      return event.device === 'cameras' ? 'monitor' : 'peek';
    case 'vote':
      return 'flip';
    case 'meeting_end':
      return 'thud';
    case 'game_over':
      return event.winner === 'artisan' ? 'fanfareWin' : 'fanfareLose';
    default:
      return null;
  }
}

/** 書き出しで鳴らす音の並び。at は書き出しの頭からの秒。 */
export type ScoreItem =
  | { at: number; effect: Effect }
  | { at: number; blip: number }
  /** length があれば、そこで止める（番組の場面の切れ目で、音声を切る時）。 */
  | { at: number; clip: string; offset: number; length?: number }
  /** BGM。曲の offset 秒の所から length 秒ぶん、くり返しながら流す。gain は音量、fadeIn・fadeOut は入りと終わりのなめらかさ（秒）。 */
  | { at: number; music: string; offset: number; length: number; gain: number; fadeIn: number; fadeOut: number }
  /** 声が鳴っている間（duck 秒）。BGM をこの間だけ小さくする。 */
  | { at: number; duck: number; level: number };

/** 音声のない発言の「しゃべり声」の間隔（秒）と、文字が出ているあいだの割合。 */
export const BLIP_EVERY = 0.085;
export const BLIP_SPAN = 0.78;

/** 上映の from〜to 秒に鳴る音を、時刻の順に並べる（書き出し用。上映は合図をまたいだ時に1つずつ鳴らす）。 */
export function scoreOf(show: Show, options: { secrets: boolean; from: number; to: number; startsOnly?: boolean }): ScoreItem[] {
  const { from, to, secrets } = options;
  const items: ScoreItem[] = [];
  const flipped = new Set<number>();
  for (const [index, cue] of show.cues.entries()) {
    const { event } = cue;
    // 集会の発言と、見回りの間の声（重なりすぎて、ふきだしだけにした声は鳴らさない）
    if (event.type === 'speak' || event.type === 'chat') {
      if (event.type === 'chat' && !cue.voiced) continue;
      if (cue.clip) {
        // 書き出しの頭より前に始まって、まだ続いている音声は、途中から流す
        // （startsOnly の時は、この範囲で始まる音声だけ。上映で、またいだ合図を鳴らす時）
        if (options.startsOnly ? cue.at >= from && cue.at < to : cue.at < to && cue.at + cue.clip.seconds > from) items.push({ at: Math.max(0, cue.at - from), clip: cue.clip.file, offset: Math.max(0, from - cue.at) });
      } else {
        const seat = show.log.seats.indexOf(event.speaker);
        const end = cue.at + (cue.end - cue.at) * BLIP_SPAN;
        for (let at = cue.at, n = 0; at < end; at += BLIP_EVERY, n++) {
          if (at < from || at >= to) continue;
          items.push({ at: at - from, blip: (300 + seat * 46) * (0.94 + rand(index * 131 + n) * 0.12) });
        }
      }
      continue;
    }
    if (cue.at < from || cue.at >= to) continue;
    const effect = effectOf(event, secrets);
    if (!effect) continue;
    if (effect === 'flip') {
      if (flipped.has(cue.at)) continue;
      flipped.add(cue.at);
    }
    items.push({ at: cue.at - from, effect });
    // クビの場面: はんこ「クビ」を押す音
    if (event.type === 'meeting_end' && event.ejected) {
      const stampAt = cue.at + FIRED.stamp;
      if (stampAt >= from && stampAt < to) items.push({ at: stampAt - from, effect: 'stamp' });
    }
  }
  // 案内役の一言（役職を明かす一言は、役職を見せている時だけ）
  for (const [n, callout] of show.callouts.entries()) {
    if (!callout.voiced || (callout.secret && !secrets)) continue;
    if (callout.clip) {
      if (options.startsOnly ? callout.at >= from && callout.at < to : callout.at < to && callout.at + callout.clip.seconds > from) items.push({ at: Math.max(0, callout.at - from), clip: callout.clip.file, offset: Math.max(0, from - callout.at) });
      continue;
    }
    const end = callout.at + (callout.end - callout.at) * BLIP_SPAN;
    for (let at = callout.at, k = 0; at < end; at += BLIP_EVERY, k++) {
      if (at < from || at >= to) continue;
      items.push({ at: at - from, blip: NARRATOR_BLIP * (0.94 + rand(n * 977 + k) * 0.12) });
    }
  }
  // 餅に変える直前の差し込み（役職を見せている時だけ）。効果音と、妖精の決めぜりふ
  if (secrets) {
    for (const cut of show.cutins) {
      if (cut.at >= from && cut.at < to) items.push({ at: cut.at - from, effect: 'cutin' });
      if (!cut.clip) {
        // 音声が無い時は、妖精の「しゃべり声」
        const seat = show.log.seats.indexOf(cut.pairs[0]?.by ?? '');
        for (let at = cut.at + CUTIN_VOICE_DELAY, k = 0; at < cut.end - 0.2; at += BLIP_EVERY, k++) {
          if (at >= from && at < to) items.push({ at: at - from, blip: (300 + seat * 46) * (0.94 + rand(cut.at * 31 + k) * 0.12) });
        }
        continue;
      }
      const voiceAt = cut.at + CUTIN_VOICE_DELAY;
      const length = cut.end + 0.3 - voiceAt;
      if (options.startsOnly ? voiceAt >= from && voiceAt < to : voiceAt < to && voiceAt + Math.min(length, cut.clip.seconds) > from) {
        items.push({ at: Math.max(0, voiceAt - from), clip: cut.clip.file, offset: Math.max(0, from - voiceAt), length: Math.max(0, length - Math.max(0, from - voiceAt)) });
      }
    }
  }
  return items.sort((a, b) => a.at - b.at);
}

/** 案内役の「しゃべり声」の高さ（音声が無い時）。 */
export const NARRATOR_BLIP = 420;

/** 差し込みが始まってから、決めぜりふを言い始めるまで（秒）。 */
export const CUTIN_VOICE_DELAY = 0.22;

export class Sound {
  enabled = true;
  private audio: BaseAudioContext | null = null;
  private master: GainNode | null = null;
  private voice: GainNode | null = null;
  private readonly clips = new Map<string, Promise<AudioBuffer | null>>();
  private current: AudioBufferSourceNode | null = null;
  private clipToken = 0;
  /** 書き出しの時、いま並べている音の時刻（秒）。上映の時は null（いまの時刻に鳴らす）。 */
  private base: number | null = null;

  /** 書き出し用: seconds 秒ぶんの音を、先に作る仕組みの上に用意する。 */
  static offline(seconds: number, sampleRate = 48000): Sound {
    const sound = new Sound();
    sound.wire(new OfflineAudioContext(2, Math.max(1, Math.ceil(seconds * sampleRate)), sampleRate));
    return sound;
  }

  private wire(audio: BaseAudioContext): void {
    this.audio = audio;
    this.master = audio.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(audio.destination);
    // 声は効果音より大きく
    this.voice = audio.createGain();
    this.voice.gain.value = 1;
    this.voice.connect(audio.destination);
  }

  /** 音を出す仕組みを用意する（まだ鳴らせなくてもよい。音声を先に解いておくのに使う）。 */
  private context(): BaseAudioContext {
    if (!this.audio) this.wire(new AudioContext());
    return this.audio as BaseAudioContext;
  }

  /** 利用者が操作したあとで呼ぶ（ブラウザは、操作の前に音を鳴らさせてくれない）。 */
  unlock(): void {
    const audio = this.context();
    if (audio instanceof AudioContext) void audio.resume();
  }

  /** 音を出す仕組みの状態（'running' なら鳴らせる。まだ用意していなければ 'none'）。 */
  state(): string {
    return this.audio?.state ?? 'none';
  }

  /** 効果音を鳴らす。at を渡すと、書き出しの頭からその秒に置く。 */
  play(effect: Effect, at: number | null = null): void {
    this.base = at;
    if (effect === 'bell') this.bell();
    else if (effect === 'nap') this.nap();
    else if (effect === 'cutin') this.cutin();
    else if (effect === 'pon') this.pon();
    else if (effect === 'lightsOut') this.lightsOut();
    else if (effect === 'alarm') this.alarm();
    else if (effect === 'shut' || effect === 'open') this.clack(effect === 'shut');
    else if (effect === 'relief') this.relief();
    else if (effect === 'creak') this.creak();
    else if (effect === 'flip') this.flip();
    else if (effect === 'thud') this.thud();
    else if (effect === 'stamp') this.stamp();
    else if (effect === 'peek') this.peek();
    else if (effect === 'monitor') this.monitor();
    else this.fanfare(effect === 'fanfareWin');
    this.base = null;
  }

  /** 書き出し用: 並べた音を全部置いて、1本の音にする。音声ファイルは url で読む。 */
  async render(score: readonly ScoreItem[], url: (file: string) => string): Promise<AudioBuffer> {
    const audio = this.audio;
    if (!(audio instanceof OfflineAudioContext) || !this.voice) throw new Error('書き出し用の音ではありません（Sound.offline で作る）');
    const files = [...new Set(score.flatMap((item) => ('clip' in item ? [item.clip] : 'music' in item ? [item.music] : [])))];
    const buffers = new Map(await Promise.all(files.map(async (file) => [file, await this.preload(url(file))] as const)));
    const missing = files.filter((file) => !buffers.get(file));
    if (missing.length > 0) throw new Error(`音声を読めませんでした: ${missing.join('、')}`);
    // BGM の通り道。声が鳴っている間だけ小さくする
    const bus = audio.createGain();
    bus.gain.setValueAtTime(1, 0);
    bus.connect(audio.destination);
    for (const item of score) {
      if (!('duck' in item)) continue;
      bus.gain.setTargetAtTime(item.level, Math.max(0, item.at - 0.08), 0.05);
      bus.gain.setTargetAtTime(1, item.at + item.duck + 0.12, 0.22);
    }
    for (const item of score) {
      if ('duck' in item) continue;
      if ('music' in item) {
        const buffer = buffers.get(item.music) as AudioBuffer;
        if (item.length <= 0) continue;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.loop = true;
        const level = audio.createGain();
        const end = item.at + item.length;
        level.gain.setValueAtTime(item.fadeIn > 0 ? 0 : item.gain, item.at);
        if (item.fadeIn > 0) level.gain.linearRampToValueAtTime(item.gain, item.at + item.fadeIn);
        if (item.fadeOut > 0) {
          level.gain.setValueAtTime(item.gain, Math.max(item.at, end - item.fadeOut));
          level.gain.linearRampToValueAtTime(0, end);
        }
        source.connect(level).connect(bus);
        source.start(item.at, item.offset % buffer.duration);
        source.stop(end + 0.02);
        continue;
      }
      if ('effect' in item) this.play(item.effect, item.at);
      else if ('blip' in item) {
        this.base = item.at;
        this.blip(item.blip);
        this.base = null;
      } else {
        const buffer = buffers.get(item.clip) as AudioBuffer;
        if (item.offset >= buffer.duration) continue;
        const source = audio.createBufferSource();
        source.buffer = buffer;
        source.connect(this.voice);
        if (item.length !== undefined) source.start(item.at, item.offset, Math.max(0, item.length));
        else source.start(item.at, item.offset);
      }
    }
    return audio.startRendering();
  }

  private tone(freq: number, delay: number, length: number, options: { type?: OscillatorType; gain?: number; slideTo?: number; attack?: number } = {}): void {
    if (!this.enabled || !this.audio || !this.master) return;
    const start = (this.base ?? this.audio.currentTime) + delay;
    const osc = this.audio.createOscillator();
    const gain = this.audio.createGain();
    osc.type = options.type ?? 'sine';
    osc.frequency.setValueAtTime(freq, start);
    if (options.slideTo) osc.frequency.exponentialRampToValueAtTime(options.slideTo, start + length);
    const peak = options.gain ?? 0.2;
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + (options.attack ?? 0.008));
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);
    osc.connect(gain).connect(this.master);
    osc.start(start);
    osc.stop(start + length + 0.05);
  }

  /** 集会の鐘（2回）。 */
  bell(): void {
    for (const strike of [0, 0.8]) {
      for (const [partial, gain] of [[1, 0.3], [2.01, 0.16], [2.76, 0.12], [4.1, 0.06]] as const) {
        this.tone(660 * partial, strike, 1.9 / Math.sqrt(partial), { gain });
      }
    }
  }

  /** 風を切る音（色のついた雑音を、帯域を動かしながら鳴らす）。 */
  private whoosh(delay: number, length: number, from: number, to: number, gain: number): void {
    if (!this.enabled || !this.audio || !this.master) return;
    const audio = this.audio;
    const start = (this.base ?? audio.currentTime) + delay;
    const buffer = audio.createBuffer(1, Math.ceil(audio.sampleRate * length), audio.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = rand(i * 7.31) * 2 - 1;
    const source = audio.createBufferSource();
    source.buffer = buffer;
    const filter = audio.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(from, start);
    filter.frequency.exponentialRampToValueAtTime(to, start + length);
    const level = audio.createGain();
    level.gain.setValueAtTime(0.0001, start);
    level.gain.exponentialRampToValueAtTime(gain, start + length * 0.3);
    level.gain.exponentialRampToValueAtTime(0.0001, start + length);
    source.connect(filter).connect(level).connect(this.master);
    source.start(start);
    source.stop(start + length + 0.05);
  }

  /** 妖精の見せ場の差し込み（しゅばっと入って、きらーんと光る）。 */
  cutin(): void {
    this.whoosh(0, 0.32, 600, 5200, 0.55);
    for (const [freq, delay] of [[1319, 0.12], [1760, 0.17], [2637, 0.22]] as const) this.tone(freq, delay, 0.7, { type: 'triangle', gain: 0.09 });
    this.tone(196, 0.1, 0.5, { slideTo: 98, gain: 0.22, type: 'sawtooth' });
    this.whoosh(1.92, 0.28, 4800, 700, 0.4);
  }

  /** ずんだ餅に変わる（きらっと上がって、もちっと弾む）。名前の nap は、前の題材のなごり。 */
  nap(): void {
    this.tone(1047, 0, 0.18, { slideTo: 1568, gain: 0.12, type: 'triangle' });
    this.tone(1568, 0.08, 0.16, { slideTo: 2093, gain: 0.08, type: 'triangle' });
    this.tone(392, 0.22, 0.42, { slideTo: 262, gain: 0.2, type: 'sine' });
  }

  /** 仕込みが1つ終わった（小さく、ぽん）。 */
  pon(): void {
    this.tone(880, 0, 0.12, { type: 'triangle', gain: 0.07, slideTo: 1320, attack: 0.004 });
  }

  /** あかりが消えた（すうっと下がって、しぼむ）。 */
  lightsOut(): void {
    this.tone(520, 0, 0.9, { type: 'sawtooth', gain: 0.1, slideTo: 60 });
    this.tone(1040, 0, 0.5, { gain: 0.08, slideTo: 130 });
  }

  /** かまどの焚きすぎ（半鐘のように、早く3回）。 */
  alarm(): void {
    for (const strike of [0, 0.22, 0.44]) {
      this.tone(988, strike, 0.2, { type: 'square', gain: 0.09 });
      this.tone(1482, strike, 0.16, { type: 'triangle', gain: 0.08 });
    }
  }

  /** 戸が閉まった・開いた（木の、ことん）。 */
  clack(shut: boolean): void {
    this.tone(shut ? 210 : 320, 0, 0.09, { type: 'square', gain: shut ? 0.16 : 0.08, slideTo: shut ? 90 : 200, attack: 0.003 });
    if (shut) this.tone(140, 0.07, 0.14, { type: 'triangle', gain: 0.18, slideTo: 70, attack: 0.003 });
  }

  /** 困りごとが片づいた（ほっとする、上がる2音）。 */
  relief(): void {
    this.tone(659, 0, 0.22, { type: 'triangle', gain: 0.16 });
    this.tone(988, 0.14, 0.5, { type: 'triangle', gain: 0.16 });
  }

  /** 床下の揚げ板（低い、きしみ）。 */
  creak(): void {
    this.tone(120, 0, 0.3, { type: 'sawtooth', gain: 0.07, slideTo: 190 });
  }

  /** 見取り図の盤・名札かけを見る（木の札に、こつん、と触れる2音）。 */
  peek(): void {
    this.tone(620, 0, 0.08, { type: 'triangle', gain: 0.1, attack: 0.003 });
    this.tone(830, 0.07, 0.12, { type: 'triangle', gain: 0.09, attack: 0.003 });
  }

  /** 防犯カメラの画面がつく（ぷつっ、と小さな電子音）。 */
  monitor(): void {
    this.tone(1760, 0, 0.05, { type: 'square', gain: 0.05, attack: 0.002 });
    this.tone(2350, 0.06, 0.09, { type: 'square', gain: 0.045, attack: 0.002 });
    this.tone(90, 0, 0.25, { type: 'sawtooth', gain: 0.03, slideTo: 140 });
  }

  /** 札を開く。 */
  flip(): void {
    for (const [i, f] of [900, 1200, 1500].entries()) this.tone(f, i * 0.05, 0.09, { type: 'triangle', gain: 0.14 });
  }

  /** 結果が出る。 */
  thud(): void {
    this.tone(160, 0, 0.32, { slideTo: 70, gain: 0.4 });
    this.tone(523, 0.02, 0.5, { type: 'triangle', gain: 0.12 });
  }

  /** はんこ「クビ」（紙をたたく、どん）。 */
  stamp(): void {
    this.whoosh(0, 0.09, 3200, 500, 0.45);
    this.tone(140, 0, 0.28, { type: 'square', gain: 0.22, slideTo: 55, attack: 0.002 });
    this.tone(70, 0.01, 0.4, { gain: 0.45, slideTo: 40, attack: 0.002 });
  }

  /** おしまいの音。 */
  fanfare(artisansWon: boolean): void {
    const notes = artisansWon ? [523, 659, 784, 1047, 784, 1047, 1319] : [440, 523, 622, 587, 466, 440, 349];
    notes.forEach((f, i) => this.tone(f, i * 0.16, i === notes.length - 1 ? 1.1 : 0.3, { type: 'triangle', gain: 0.2 }));
  }

  /** 音声のない発言の「しゃべり声」（1文字ごとの短い音）。 */
  blip(pitch: number): void {
    this.tone(pitch, 0, 0.07, { type: 'triangle', gain: 0.07, attack: 0.004 });
  }

  /** 音声を読み込んで解いておく。 */
  preload(url: string): Promise<AudioBuffer | null> {
    let loading = this.clips.get(url);
    if (!loading) {
      const audio = this.context();
      loading = fetch(url)
        .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject(new Error(String(response.status)))))
        .then((bytes) => audio.decodeAudioData(bytes))
        .catch(() => null);
      this.clips.set(url, loading);
    }
    return loading;
  }

  /** 音声の読み込みが、いくつ済んだか（録画の前に、全部そろったかを確かめるため）。 */
  async ready(): Promise<number> {
    return (await Promise.all(this.clips.values())).filter((buffer) => buffer !== null).length;
  }

  /** 音声を、途中の位置から流す。読み込みが間に合わなかった時は、遅れた分だけ先から流す。 */
  playClip(url: string, offset: number, rate: number): void {
    this.stopClip();
    if (!this.enabled) return;
    const token = this.clipToken;
    const asked = performance.now();
    void this.preload(url).then((buffer) => {
      if (!buffer || token !== this.clipToken || !this.audio || !this.voice || !this.enabled) return;
      const at = offset + ((performance.now() - asked) / 1000) * rate;
      if (at >= buffer.duration) return;
      const source = this.audio.createBufferSource();
      source.buffer = buffer;
      source.playbackRate.value = rate;
      source.connect(this.voice);
      source.start(0, Math.max(0, at));
      this.current = source;
    });
  }

  stopClip(): void {
    this.clipToken += 1;
    try {
      this.current?.stop();
    } catch {
      // まだ始まっていない・もう止まっている
    }
    this.current = null;
  }
}
