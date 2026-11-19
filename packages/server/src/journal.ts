// 追記専用の記録。頭脳への要求は「呼ぶ前」に、応答は「届いた時」に1件ずつ残す。
// ファイルには書かない（ブラウザの中でも試合を動かせるように）。保存したい時は、呼ぶ側が entries を書き出す。

import type { JournalEntry, StampedJournalEntry } from '../../protocol/src/index.ts';

export class Journal {
  readonly entries: StampedJournalEntry[] = [];
  private readonly now: () => Date;

  constructor(now: () => Date = () => new Date()) {
    this.now = now;
  }

  append(entry: JournalEntry): void {
    this.entries.push({ seq: this.entries.length + 1, at: this.now().toISOString(), ...entry });
  }
}
