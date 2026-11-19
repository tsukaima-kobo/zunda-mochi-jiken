// 頭脳（AI）の札に出す名前。台本ボットは「台本」。

/** 札に出す頭脳を、記録の中身と別にしたい時の割り当て（登場人物の名前 → 頭脳の記録上の名前）。この公開版では使わない。 */
export const PLANNED_BRAINS: Readonly<Record<string, string>> = {};

export type BrainDisplay = 'planned' | 'actual';

/** 札と紹介に出す頭脳の名前。planned なら本番の顔ぶれ、actual なら記録どおりの中身。 */
export function displayedBrain(name: string, actual: string | null, mode: BrainDisplay): string | null {
  return mode === 'planned' ? (PLANNED_BRAINS[name] ?? actual) : actual;
}

/** 頭脳のモデルの名前（例: Claude Opus 5.5、GPT-6.2 Sol、Gemini 4 Argon、Grok）。台本ボットは「台本」。 */
export function modelLabel(brain: string | null): string {
  if (!brain || brain === 'scripted') return '台本';
  const model = brain.split(':')[1] ?? brain;
  if (brain.startsWith('claude')) return model.replace(/^claude-/, 'Claude ').replace(/-(\d+)-(\d+)$/, ' $1.$2').replace(/\b[a-z]/, (c) => c.toUpperCase());
  if (brain.startsWith('codex')) return model.replace(/^gpt-/, 'GPT-').replace(/-([a-z])/, (_, c: string) => ` ${c.toUpperCase()}`);
  // gemini-4-argon → Gemini 4 Argon、grok → Grok
  if (/^(gemini|grok)/.test(model)) return model.split('-').map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return model;
}

/** 頭脳を作った会社（台本ボットは null）。 */
export function companyOf(brain: string | null): string | null {
  if (!brain || brain === 'scripted') return null;
  if (brain.startsWith('claude')) return 'Anthropic';
  if (brain.startsWith('codex')) return 'OpenAI';
  if (brain.startsWith('gemini')) return 'Google';
  if (brain.startsWith('grok')) return 'xAI';
  return null;
}

/**
 * 紹介で案内役が添える、人柄のひとこと。cast.ts の人柄（公式のプロフィールをもとにしたもの）を短くしたもの。
 * 頭脳には渡さない（紹介の台詞だけに使う）。
 */
/** AI の系統の呼び名（声で言う時の短い名前）。 */
export function familyOf(brain: string | null): string | null {
  const company = companyOf(brain);
  return company === 'Anthropic' ? 'Claude' : company === 'OpenAI' ? 'GPT' : company === 'Google' ? 'Gemini' : company === 'xAI' ? 'Grok' : null;
}
