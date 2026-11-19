// 頭脳の出力を、試合に通す前に検査する（長さ・行動の形・役から外れた発言・メールアドレスやパスなどの個人の情報）。

import { NO_TARGET, openDuties, ROAM_SAY_MAX_CHARS, roamActions, RoamIntent, SABOTAGE_CRISIS, SABOTAGE_LIGHTS, SKIP_VOTE, SpeakIntent, VoteIntent } from '../../protocol/src/index.ts';
import type { MeetingIntent, MeetingObservation, RoamObservation, SuspicionEntry } from '../../protocol/src/index.ts';

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/;
const ABSOLUTE_PATH = /(\/Users\/|\/home\/|\/private\/|\/var\/folders\/|\/Volumes\/|[A-Za-z]:\\)/;
// 役から外れて、自分が AI であることや仕組みに触れた発言
const OUT_OF_CHARACTER = /(Claude|Anthropic|OpenAI|ChatGPT|GPT-|Codex|システムプロンプト|system prompt|JSON)/i;

/** 投票のときに書く覚え書きの長さの上限。 */
export const MEMO_MAX_CHARS = 120;

export function privateDataProblems(text: string, denyList: readonly string[]): string[] {
  const problems: string[] = [];
  if (EMAIL.test(text)) problems.push('private:email');
  if (ABSOLUTE_PATH.test(text)) problems.push('private:path');
  const lower = text.toLowerCase();
  if (denyList.some((word) => lower.includes(word.toLowerCase()))) problems.push('private:deny_list');
  return problems;
}

export type Verdict =
  | { ok: true; intent: MeetingIntent }
  /** trimmable: 長すぎること以外に問題がない発言。切れば使える。 */
  | { ok: false; problems: string[]; trimmable: SpeakIntent | null };

/**
 * 疑い度をそろえる。候補にない名前・重なった名前は捨て、0〜5 の整数に丸める（聞き直しはしない。足りない人は答えなかった扱い）。
 * 並びは候補の順（席順）にする。
 */
export function normalizeSuspicion(entries: readonly SuspicionEntry[], options: readonly string[]): SuspicionEntry[] {
  const names = options.filter((option) => option !== SKIP_VOTE);
  const levels = new Map<string, number>();
  for (const entry of entries) {
    if (!names.includes(entry.name) || levels.has(entry.name) || !Number.isFinite(entry.level)) continue;
    levels.set(entry.name, Math.max(0, Math.min(5, Math.round(entry.level))));
  }
  return names.filter((name) => levels.has(name)).map((name) => ({ name, level: levels.get(name) as number }));
}

export function checkIntent(obs: MeetingObservation, json: unknown, denyList: readonly string[]): Verdict {
  // 発言・朝礼・日記・感想会は、どれも say を返す
  if (obs.phase !== 'vote') {
    const parsed = SpeakIntent.safeParse(json);
    if (!parsed.success) return { ok: false, problems: ['shape'], trimmable: null };
    const intent = parsed.data;
    const problems = [
      ...privateDataProblems(`${intent.say}\n${intent.thought}`, denyList),
      ...(OUT_OF_CHARACTER.test(intent.say) ? ['out_of_character'] : []),
      ...(obs.options.includes(intent.suspect) ? [] : ['option']),
    ];
    const tooLong = [...intent.say].length > obs.limits.sayMaxChars;
    if (problems.length === 0 && !tooLong) return { ok: true, intent: { kind: 'speak', ...intent } };
    return { ok: false, problems: tooLong ? [...problems, 'too_long'] : problems, trimmable: problems.length === 0 ? intent : null };
  }
  const parsed = VoteIntent.safeParse(json);
  if (!parsed.success) return { ok: false, problems: ['shape'], trimmable: null };
  // 覚え書きは本人の記憶にしか残らないが、観戦者には見せるので、同じように検査する。長すぎる分は切る
  const intent = { ...parsed.data, memo: trimSay(parsed.data.memo, MEMO_MAX_CHARS), suspicion: normalizeSuspicion(parsed.data.suspicion, obs.options) };
  const problems = [
    ...privateDataProblems(`${intent.thought}\n${intent.memo}`, denyList),
    ...(obs.options.includes(intent.vote) ? [] : ['option']),
    // 最後の局面での従業員のスキップは、負けを選ぶのと同じ。一度だけ聞き直す（本人の役職と、全員に公開された人数だけで決まる）
    ...(obs.stakes?.lastChance && obs.self.role === 'artisan' && intent.vote === SKIP_VOTE ? ['last_chance_skip'] : []),
  ];
  if (problems.length === 0) return { ok: true, intent: { kind: 'vote', ...intent } };
  return { ok: false, problems, trimmable: null };
}

/**
 * 聞き直しのときに本人へ返す文。本人の出力の問題と、本人の観測に入っている値だけから作る
 * （ここに真の状態から来た文字列を混ぜると、漏れ口になる）。
 */
export function feedbackFor(problems: readonly string[], obs: MeetingObservation): string {
  const parts: string[] = [];
  if (problems.includes('shape')) parts.push('指定された形の JSON だけを返してください。');
  if (problems.includes('too_long')) parts.push(`say は${obs.limits.sayTargetChars}字以内にしてください。`);
  if (problems.includes('option')) parts.push(`候補は次のどれかです: ${obs.options.join(' / ')}`);
  if (problems.includes('out_of_character')) parts.push('ゲームの中の人物として話してください。');
  if (problems.includes('last_chance_skip')) {
    parts.push('いまスキップすると、次に1人がずんだ餅になった時点で妖精の勝ちです。確かな手がかりがなくても、出席者の中でいちばん怪しい人に入れてください。');
  }
  if (problems.some((p) => p.startsWith('private:'))) {
    parts.push('ゲームの外のこと（メールアドレス、フォルダ名、機械の名前など）には触れないでください。');
  }
  return parts.join(' ');
}

/** 長すぎる発言を、上限までの最後の文の終わりで切る。文の終わりが無ければ上限で切って「…」を付ける。 */
export function trimSay(say: string, maxChars: number): string {
  const chars = [...say.trim()];
  if (chars.length <= maxChars) return chars.join('');
  if (maxChars < 3) return chars.slice(0, maxChars).join('');
  const head = chars.slice(0, maxChars);
  for (let i = head.length - 1; i >= Math.floor(maxChars / 3); i--) {
    if ('。！？!?'.includes(head[i] as string)) return head.slice(0, i + 1).join('');
  }
  return `${head.slice(0, maxChars - 1).join('')}…`;
}

export type RoamDecision = { kind: 'roam' } & RoamIntent;

export type RoamVerdict = { ok: true; intent: RoamDecision } | { ok: false; problems: string[] };

export function checkRoamIntent(obs: RoamObservation, json: unknown, denyList: readonly string[]): RoamVerdict {
  const parsed = RoamIntent.safeParse(json);
  if (!parsed.success) return { ok: false, problems: ['shape'] };
  const intent = parsed.data;
  // 本人に選べない行動（妖精でないのに、妖精だけの行動）は受け付けない
  if (!roamActions(obs).includes(intent.action)) return { ok: false, problems: ['action'] };
  const awake = obs.visible.filter((v) => !v.asleep).map((v) => v.name);
  const asleep = obs.visible.filter((v) => v.asleep).map((v) => v.name);
  const { action, target } = intent;
  const noTarget = action === 'wait' || action === 'call_meeting';
  const duties = openDuties(obs);
  let fits: boolean;
  if (action === 'move_to') fits = obs.rooms.includes(target);
  else if (action === 'report') fits = asleep.includes(target);
  else if (noTarget) fits = true;
  // 仕込みと直す場所は、名前が合わなければ「なし」（近いものから）として受ける。聞き直しで呼び出しを増やさない
  else if (action === 'do_task') fits = duties.length > 0;
  else if (action === 'fix') fits = !!obs.trouble;
  else if (action === 'sneak') fits = (obs.hatches ?? []).some((group) => group.rooms.includes(target));
  else if (action === 'check') fits = (obs.devices ?? []).some((device) => device.name === target);
  else if (action === 'sabotage') fits = target === SABOTAGE_LIGHTS || target === SABOTAGE_CRISIS || (obs.sabotage?.doorRooms.includes(target) ?? false);
  else fits = awake.includes(target);
  // どの行動の target が合わなかったかを残す（聞き直しの文を、本人が選んだ行動の分だけにするため）
  const problems = [...privateDataProblems(intent.thought, denyList), ...privateDataProblems(intent.say, denyList), ...(fits ? [] : ['target', `target:${action}`])];
  if (problems.length > 0) return { ok: false, problems };
  const named = action === 'do_task' ? duties.includes(target) : action === 'fix' ? (obs.trouble?.fixAt.some((f) => f.name === target) ?? false) : !noTarget;
  // 声は、話せる時だけ。長すぎる分は切り、役から外れた声は出さない（どちらも聞き直しで呼び出しを増やさない）
  const spoken = trimSay(intent.say.replace(/\s+/g, ' '), ROAM_SAY_MAX_CHARS);
  const say = (obs.chatWaitSeconds ?? 0) > 0 || OUT_OF_CHARACTER.test(spoken) ? '' : spoken;
  return { ok: true, intent: { kind: 'roam', ...intent, say, target: named ? target : NO_TARGET } };
}

/** 聞き直しの文。本人の観測に入っている値だけから作る（役職で変わる行動の説明は、本人がその行動を選んだ時にだけ出る）。 */
export function roamFeedbackFor(problems: readonly string[], obs: RoamObservation): string {
  const parts: string[] = [];
  if (problems.includes('shape')) parts.push('指定された形の JSON だけを返してください。');
  if (problems.includes('action')) parts.push(`action は次のどれかにしてください: ${roamActions(obs).join(' / ')}`);
  if (problems.includes('target')) {
    const wrong = problems.find((p) => p.startsWith('target:'))?.slice('target:'.length) ?? '';
    const awake = obs.visible.filter((v) => !v.asleep).map((v) => v.name);
    const asleep = obs.visible.filter((v) => v.asleep).map((v) => v.name);
    const list = (items: readonly string[], none: string) => (items.length > 0 ? items.join(' / ') : none);
    if (wrong === 'move_to') parts.push(`move_to の target は場所の名前にしてください: ${obs.rooms.join(' / ')}`);
    else if (wrong === 'report') parts.push(`report の target は、いま見えている、ずんだ餅になった人にしてください（${list(asleep, 'いまは見えていない')}）。`);
    else if (wrong === 'do_task') parts.push('自分の仕込みは、もう残っていません。ほかの行動を選んでください。');
    else if (wrong === 'fix') parts.push('いま、直すものはありません。ほかの行動を選んでください。');
    else if (wrong === 'check') parts.push(`check の target は、道具の名前にしてください: ${(obs.devices ?? []).map((d) => d.name).join(' / ')}`);
    else if (wrong === 'sneak') parts.push(`sneak の target は、抜け道の出入口のある部屋にしてください: ${(obs.hatches ?? []).flatMap((group) => group.rooms).join(' / ')}`);
    else if (wrong === 'sabotage') parts.push(`sabotage の target は「${SABOTAGE_LIGHTS}」「${SABOTAGE_CRISIS}」か、戸を閉められる部屋の名前にしてください: ${(obs.sabotage?.doorRooms ?? []).join(' / ')}`);
    else parts.push(`${wrong} の target は、いま見えている起きている相手にしてください（${list(awake, 'いまは誰も見えていない')}）。`);
  }
  if (problems.some((p) => p.startsWith('private:'))) {
    parts.push('ゲームの外のこと（メールアドレス、フォルダ名、機械の名前など）には触れないでください。');
  }
  return parts.join(' ');
}
