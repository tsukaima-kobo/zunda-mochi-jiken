// 1人のエージェントの記憶。材料は本人の観測と、本人が自分で書いた覚え書きだけ。
// 歩き回っている間の観測を見比べて、「いつ・どこで・誰を見たか」を短い文で残す。
// 集会が終わると、その回の記憶は「大事な行」と「覚え書き」だけに畳む（プロンプトが際限なく伸びないように）。

import type { RoamObservation } from '../../protocol/src/index.ts';

export function clockLabel(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** 起きている姿を最後に見た時（試合の間、回をまたいで残す）。 */
export interface Sighting {
  at: string;
  where: string;
  /** そのとき同じ場所に見えていた、ほかの起きている人。 */
  with: string[];
}

/** 工房の道具（見取り図の盤・名札かけ・防犯カメラの画面）を見終わった時の結果。集会でも使う手がかりなので、大事な行に残す。 */
const DEVICE_READING = /」を(\d+秒ほど)?見た: /;

/** 見え隠れ（廊下の角や戸口）で同じ人を何度も書かないよう、同じ場所でこの秒数のうちにまた見えた時は書かない。 */
const REPEAT_SECONDS = 10;

export interface PastRound {
  round: number;
  /** 目撃・発見・自分のしたこと。細かな移動の記録は残さない。 */
  keyLines: string[];
  /** 集会の終わりに本人が書いた覚え書き。 */
  memo: string;
}

export class AgentMemory {
  /** 今回の見回りで見聞きしたこと。 */
  lines: string[] = [];
  /** 今回の見回りで聞こえた声と、自分が言ったこと。 */
  talk: string[] = [];
  readonly past: PastRound[] = [];
  private keyLines: string[] = [];
  private round = 1;
  private previous: RoamObservation | null = null;
  /** 記憶に書いた、最後の「見かけた」（見え隠れをまとめるため）。 */
  private noted = new Map<string, { at: number; where: string; working: boolean }>();
  private sightings = new Map<string, Sighting>();

  /** 同じ時刻・同じ場所で何人も見た行は、1行にまとめる（時刻だらけの記憶にしないため）。 */
  private group: { kind: string; index: number; names: string[]; render: (names: string[]) => string } | null = null;

  private note(line: string, key = false): void {
    this.lines.push(line);
    if (key) this.keyLines.push(line);
    this.group = null;
  }

  /** kind（時刻と場所で決まる）が直前の行と同じなら、その行に名前を足す。 */
  private noteGrouped(kind: string, name: string, render: (names: string[]) => string): void {
    if (this.group && this.group.kind === kind && this.group.index === this.lines.length - 1) {
      this.group.names.push(name);
      this.lines[this.group.index] = this.group.render(this.group.names);
      return;
    }
    this.note(render([name]));
    this.group = { kind, index: this.lines.length - 1, names: [name], render };
  }

  perceive(obs: RoamObservation): void {
    // 集会を挟んで新しい見回りが始まっていたら、前の回を畳む（覚え書きを書く機会が無かった場合）
    if (obs.round !== this.round) {
      if (this.lines.length > 0 || this.keyLines.length > 0) this.closeRound('');
      this.round = obs.round;
    }
    const at = clockLabel(obs.clock);
    const before = this.previous;
    if (!before) {
      this.note(`${at} ${obs.where} にいた`);
    } else if (before.where !== obs.where) {
      this.note(`${at} ${obs.where} に入った`);
    }

    const seenBefore = new Map((before?.visible ?? []).map((v) => [v.name, v]));
    const seenNow = new Map(obs.visible.map((v) => [v.name, v]));
    const awake = obs.visible.filter((v) => !v.asleep);
    for (const [name, now] of seenNow) {
      const was = seenBefore.get(name);
      if (now.asleep) {
        // 起きている姿を見ていた相手が餅に変わったときは、その瞬間の出来事（events）のほうに書かれる。
        // 見つけた時にそばに見えていた人は、集会でいちばんの手がかりになるので、同じ行に書く
        if (was === undefined) {
          const near = awake.map((v) => (v.where === now.where ? v.name : `${v.name}（${v.where}）`));
          this.note(`${at} ${now.where} で、ずんだ餅になった ${name} を見つけた（${near.length > 0 ? `そばに見えていたのは ${near.join('、')}` : 'そばには誰も見えなかった'}）`, true);
        }
        continue;
      }
      this.sightings.set(name, { at, where: now.where, with: awake.filter((v) => v.name !== name && v.where === now.where).map((v) => v.name) });
      const last = this.noted.get(name);
      const recently = last !== undefined && last.where === now.where && obs.clock - last.at <= REPEAT_SECONDS;
      if (was === undefined) {
        if (!recently) this.noteGrouped(`seen:${at}:${now.where}`, name, (names) => `${at} ${now.where} にいる ${names.join('、')} を見かけた`);
      } else if (was.where !== now.where) {
        this.noteGrouped(`moved:${at}:${was.where}:${now.where}`, name, (names) => `${at} ${names.join('、')} が ${was.where} から ${now.where} へ移るのを見た`);
      }
      // 持ち場で手を動かし始めた所（本当に仕込みをしているかは、見ただけでは分からない）
      if (now.working && !was?.working && !(recently && last.working)) this.note(`${at} ${name} が ${now.where} の持ち場で手を動かしているのを見た`);
      // 工房の道具を見ているところ（見た中身は、見ている本人にしか分からない）
      if (now.checking && now.checking !== was?.checking) this.note(`${at} ${name} が ${now.where} で「${now.checking}」を見ているのを見た`);
      this.noted.set(name, { at: obs.clock, where: now.where, working: now.working === true });
    }
    // 見えなくなったことは書かない。移れば見えなくなるのは当たり前で、書くと「消えた＝抜け道」と取り違えやすい。
    // 最後に見た場所と時刻は、sightings に残る

    for (const event of obs.events) this.note(`${at} ${event}`, true);
    for (const voice of obs.heard ?? []) {
      if (voice.speaker === obs.self.name) this.talk.push(`${at} 自分「${voice.text}」`);
      else this.talk.push(`${at} ${voice.speaker}（${voice.where ?? '姿は見えなかった'}）「${voice.text}」`);
    }
    if (obs.lastResult && obs.lastResult !== before?.lastResult) {
      // 占いの結果も、集会で使う大事な手がかりなので残す
      this.note(`${at} ${obs.lastResult}`, obs.lastResult.includes('をずんだ餅に変えた') || obs.lastResult.includes('を占った: ') || DEVICE_READING.test(obs.lastResult));
    }
    this.previous = obs;
  }

  /** 集会が終わった。今回の記憶を、大事な行と覚え書きだけに畳む。 */
  closeRound(memo: string): void {
    this.past.push({ round: this.round, keyLines: this.keyLines, memo: memo.trim() });
    this.lines = [];
    this.keyLines = [];
    this.talk = [];
    this.previous = null;
    this.group = null;
    this.noted.clear();
    this.round += 1;
  }

  /** 起きている姿を最後に見た時（見たことのある人の分だけ）。 */
  lastSightings(): Record<string, Sighting> {
    return Object.fromEntries(this.sightings);
  }

  /** プロンプトに入れる、今回の分。新しいものから上限まで。大事な行は、古くても落とさない。 */
  recent(limit: number): string[] {
    const tail = this.lines.slice(-limit);
    const dropped = this.keyLines.filter((line) => !tail.includes(line));
    return [...dropped, ...tail];
  }

  /** プロンプトに入れる、今回の見回りで交わした言葉。新しいものから上限まで。 */
  recentTalk(limit: number): string[] {
    return this.talk.slice(-limit);
  }

  /** プロンプトに入れる、前の回までの分。 */
  pastNotes(): string[] {
    return this.past.flatMap((p) => [
      ...p.keyLines.map((line) => `${p.round}回目の見回り: ${line}`),
      ...(p.memo ? [`${p.round}回目の集会のあとの覚え書き: ${p.memo}`] : []),
    ]);
  }
}
