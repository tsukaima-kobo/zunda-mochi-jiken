// 頭脳の札に出す AI の名前（この公開版は、記録どおりの中身を出す）。

import { displayedBrain } from '../../server/src/lineup.ts';
export { PLANNED_BRAINS } from '../../server/src/lineup.ts';

let mode: 'planned' | 'actual' = 'actual';

export function brainDisplay(): 'planned' | 'actual' {
  return mode;
}

export function setBrainDisplay(next: 'planned' | 'actual'): void {
  mode = next;
}

/** 頭脳の札に出す頭脳の名前。 */
export function shownBrain(name: string, actual: string | null): string | null {
  return displayedBrain(name, actual, mode);
}
