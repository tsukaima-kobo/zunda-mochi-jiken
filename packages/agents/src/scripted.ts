// 台本ボット。LLM を呼ばずに、観測と本人の記憶だけから行動・発言・投票を決める。
// 開発とテストの大半はこれで回す。頭脳が使えないときの代用にもなる。
// 入力は観測と記憶と種だけ。真の状態は見ない（見ると、代用になった時だけ情報が漏れる）。

import { NO_SUSPECT, NO_TARGET, openDuties, SABOTAGE_CRISIS, SABOTAGE_LIGHTS, SKIP_VOTE } from '../../protocol/src/index.ts';
import type { MeetingIntent, MeetingObservation, RoamObservation } from '../../protocol/src/index.ts';
import { trimSay } from './guard.ts';
import type { RoamDecision } from './guard.ts';

/** 「A、B、C、D」のように名前が4人以上並んだら「A、B ほか2人」にまとめる（台本の発言が長くなりすぎないように）。 */
export function fewerNames(fact: string): string {
  return fact.replace(/[^\s、。]+(?:、[^\s、。]+){3,}/g, (list) => {
    const names = list.split('、');
    return `${names.slice(0, 2).join('、')} ほか${names.length - 2}人`;
  });
}

function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function pick<T>(items: readonly T[], salt: string): T | undefined {
  return items.length > 0 ? items[hash(salt) % items.length] : undefined;
}

/** 「A が B に手をかざし…」という目撃の文から、A の名前を取り出す。 */
function namedGiver(text: string, names: readonly string[]): string | undefined {
  // 抜け道の出入りを見たという文も、同じ形（「A が …」）なので、同じように名前を取り出す
  const at = Math.max(text.indexOf('に手をかざし'), text.indexOf('の床下の抜け道'));
  if (at < 0) return undefined;
  const head = text.slice(0, at);
  // 「〜で A が B」の A。文の中でいちばん手前に出てくる名前
  return [...names].filter((name) => head.includes(`${name} が`)).sort((a, b) => head.indexOf(`${a} が`) - head.indexOf(`${b} が`))[0];
}

/** 朝礼・日記・感想会の、台本の決まり文句。 */
function ceremonyIntent(obs: MeetingObservation, salt: string): MeetingIntent {
  const { self } = obs;
  let say: string;
  if (obs.phase === 'greet') {
    say = pick([`${self.name}です。今日もおいしいずんだ餅を作りましょう。`, `${self.name}です。開店まで、よろしくお願いします。`, `${self.name}です。みんなで気をつけて仕込みをしましょう。`], salt) as string;
  } else {
    const won = obs.reveal?.result.includes(self.role === 'artisan' ? '従業員の勝ち' : '妖精の勝ち') ?? false;
    const nibblers = (obs.reveal?.roles ?? []).filter((r) => r.role === 'nibbler').map((r) => r.name);
    const truth = self.role === 'nibbler' ? '妖精はわたしでした。' : `妖精は ${nibblers.join('と') || 'だれか'} でした。`;
    say =
      obs.phase === 'diary'
        ? `今日は工房で仕込みをした。${truth}${won ? 'うまくいって、ほっとした。' : 'くやしい一日だった。'}`
        : `${truth}${won ? 'うまくいってよかった。' : '次はがんばります。'}`;
  }
  return { kind: 'speak', thought: '（台本）', say: trimSay(say, obs.limits.sayMaxChars), suspect: NO_SUSPECT };
}

export function scriptedIntent(source: MeetingObservation, seed: number, memory: readonly string[] = []): MeetingIntent {
  const obs = { ...source, facts: [...source.facts, ...memory] };
  const { self, meeting } = obs;
  const salt = `${seed}:${self.name}:${obs.phase}:${meeting.round}:${meeting.transcript.length}`;
  if (obs.phase === 'greet' || obs.phase === 'diary' || obs.phase === 'review') return ceremonyIntent(obs, salt);
  const abstain = obs.options[obs.options.length - 1] as string;
  const others = obs.options.slice(0, -1);

  // ほかの人の発言で名前が出た回数（全員に聞こえている情報）
  const mentions = (name: string) =>
    meeting.transcript.filter((line) => line.speaker !== self.name && line.speaker !== name && line.text.includes(name)).length;
  const mostMentioned = [...others].sort((a, b) => mentions(b) - mentions(a))[0];
  // 自分が一度も見かけていない相手
  const unseen = others.filter((name) => !obs.facts.some((fact) => fact.includes(name)));

  // 自分の目で見た相手（いちばん確かな手がかり）
  const sawGiver = obs.facts.map((fact) => namedGiver(fact, others)).find((name) => name !== undefined);
  // 会議で誰かが「見た」と名指しした相手と、名指しした人
  const claim = meeting.transcript
    .filter((line) => line.speaker !== self.name)
    .map((line) => ({ by: line.speaker, who: namedGiver(line.text, [...others, self.name]) }))
    .find((c) => c.who !== undefined);

  let suspect: string;
  if (self.role === 'madman') {
    // 妖精びいき: 自分の目で見た妖精はかばい、名指しした人に疑いを向ける。決め手が無ければ、話題の人か誰かを疑う
    const accused = sawGiver ?? claim?.who;
    const accuser = claim && claim.by !== accused && others.includes(claim.by) ? claim.by : undefined;
    const pool = others.filter((name) => name !== accused);
    suspect =
      accuser ??
      (mostMentioned && mostMentioned !== accused && mentions(mostMentioned) > 0 ? mostMentioned : undefined) ??
      pick(pool, salt) ??
      abstain;
  } else if (self.role === 'nibbler') {
    // 名指しされたら、名指しした人に言い返す。されていなければ、話題になっている人に乗る
    suspect =
      claim?.who === self.name && others.includes(claim.by)
        ? claim.by
        : ((mostMentioned && mentions(mostMentioned) > 0 ? mostMentioned : pick(others, salt)) ?? abstain);
  } else {
    suspect =
      sawGiver ??
      (claim?.who && claim.who !== self.name && others.includes(claim.who) ? claim.who : undefined) ??
      [...unseen].sort((a, b) => mentions(b) - mentions(a))[0] ??
      // 最後の局面では、スキップせずに誰かに入れる（スキップは負けと同じ）
      (obs.stakes?.lastChance ? (mostMentioned ?? pick(others, salt)) : undefined) ??
      abstain;
  }

  if (obs.phase === 'vote') {
    const target = suspect !== NO_SUSPECT && suspect !== SKIP_VOTE ? suspect : abstain;
    const memo = target === abstain ? '（台本）まだ決め手がない' : `（台本）${target} を疑っている`;
    // 疑い度: 投票する相手は4、話題になっている人は2、そのほかは1。妖精は仲間を0にする
    const suspicion = others.map((name) => ({
      name,
      level: self.allies.includes(name) ? 0 : name === target ? 4 : mentions(name) > 0 ? 2 : 1,
    }));
    return { kind: 'vote', thought: `（台本）${target} に入れる`, vote: target, memo, suspicion };
  }

  // 話せる事実。妖精は自分のしたことを言わず、「ひとりで見回っていた」と言う
  const shareable = obs.facts
    .filter((fact) => !fact.includes('変える機会がなかった'))
    // 全員が気づいた知らせは、話しても手がかりにならない。妖精は、自分の妨害や抜け道のことを言わない
    .filter((fact) => !/あかりが消えた|あかりがついた|焚かれすぎている|火が落ち着いた|の戸が閉まった/.test(fact))
    .filter((fact) => self.role !== 'nibbler' || !/あかりを消した|焚きすぎにした|の戸を閉めた|抜け道/.test(fact))
    // 妖精びいきは、妖精を見たことを言わない
    .filter((fact) => self.role !== 'madman' || !(fact.includes('に手をかざし') || fact.includes('の床下の抜け道')))
    .map((fact) => (fact.includes('ずんだ餅に変えた') ? `${fact.split(' ')[0]} はひとりで見回りをしていた` : fact));
  // 狐も、見た妖精のことは言う（妖精がいなくなれば試合が終わり、起きている狐の勝ちになる）
  const witnessed = self.role === 'artisan' || self.role === 'fox' ? shareable.find((fact) => fact.includes('に手をかざし') || fact.includes('の床下の抜け道')) : undefined;
  const discovery = shareable.find((fact) => fact.includes('見つけて') || fact.includes('見つけた'));
  let say: string;
  if (witnessed) {
    say = `わたしは見た。${witnessed}。`;
  } else if (self.role === 'nibbler' && claim?.who === self.name) {
    say = `それは違うよ。${claim.by} こそ、そのころどこにいたの？`;
  } else if (self.role === 'madman' && claim?.who && claim.who !== self.name && claim.by === suspect) {
    say = `${claim.who} がそんなことをするとは思えない。${claim.by} の話こそ、つじつまが合わないよ。`;
  } else {
    const fact =
      meeting.round === 1 && discovery
        ? discovery
        : (shareable[(hash(salt) + meeting.round) % Math.max(shareable.length, 1)] ?? '特に変わったことは見ていない');
    const question = meeting.round > 1 && suspect !== abstain ? `${suspect} は、そのころどこにいたの？` : '';
    say = `わたしは ${fewerNames(fact)}。${question}`;
  }
  return { kind: 'speak', thought: `（台本）疑い先: ${suspect}`, say: trimSay(say, obs.limits.sayMaxChars), suspect };
}

/** 歩き回っている間の台本。行動を決めてから、近くの人に聞こえる声で言うことを決める。 */
export function scriptedRoamIntent(obs: RoamObservation, seed: number): RoamDecision {
  const decision = scriptedRoamAction(obs, seed);
  return { ...decision, say: (obs.chatWaitSeconds ?? 0) > 0 ? '' : scriptedChat(obs, seed, decision) };
}

/** 名前を呼ばれて、聞かれたこと（本人に聞こえた、ほかの人の声のうち、本人の名前と「？」の入ったもの）。 */
export function questionFor(obs: RoamObservation): { speaker: string; text: string } | undefined {
  return (obs.heard ?? []).find((h) => h.speaker !== obs.self.name && h.text.includes(obs.self.name) && /[？?]/.test(h.text));
}

/** 台本の声。言うことが無ければ空。 */
function scriptedChat(obs: RoamObservation, seed: number, decision: RoamDecision): string {
  const salt = `${seed}:${obs.self.name}:chat:${obs.round}:${obs.clock}`;
  const roll = hash(salt) % 10;
  const artisan = obs.self.role === 'artisan';
  const others = obs.visible.filter((v) => !v.asleep && !obs.self.allies.includes(v.name));
  const sleeper = obs.visible.find((v) => v.asleep);
  const nextRoom = (obs.duties ?? []).flatMap((duty) => duty.steps.filter((step) => !step.done)).at(0)?.room;
  // 目の前で人が餅に変わった（従業員は、見たことをそのまま叫ぶ）
  const witnessed = obs.events.find((event) => event.includes('に手をかざし'));
  if (witnessed && artisan) {
    const giver = namedGiver(witnessed, obs.roster);
    return giver ? `見た！ いま${giver}が手をかざして、餅に変えた！` : 'うわっ、目の前で人が餅に！';
  }
  if (sleeper && (artisan || decision.action === 'report')) return pick([`たいへん！ ${sleeper.name}がずんだ餅になってる！`, `${sleeper.name}！？ だれか来て！`], salt) as string;
  if (obs.trouble && decision.action === 'fix' && roll < 5) return obs.trouble.kind === 'lights' ? 'あかりが消えた！ 直しに行こう！' : 'かまどが大変！ 手を貸して！';
  const asked = questionFor(obs);
  if (asked) {
    if (decision.action === 'do_task' && nextRoom) return `${asked.speaker}、わたしは${nextRoom}で仕込みの続きだよ。`;
    if (decision.action === 'move_to') return `${asked.speaker}、${decision.target}を見てくるところ。`;
    if (decision.action === 'follow') return `${asked.speaker}、いっしょに回ろう。`;
    return `${asked.speaker}、ちょっと様子を見てるだけ。`;
  }
  if (others.length === 0 || roll >= 4) return '';
  const someone = pick(others, `${salt}:who`) as (typeof others)[number];
  if (decision.action === 'do_task' && nextRoom && roll < 2) return `${nextRoom}で仕込みしてくるね。`;
  if (decision.action === 'follow' && decision.target === someone.name) return `${someone.name}、ついていってもいい？`;
  if (roll < 3) return `${someone.name}、どこ行くの？`;
  return `${someone.name}、ここで何してたの？`;
}

/** 歩き回っている間の行動の台本。 */
function scriptedRoamAction(obs: RoamObservation, seed: number): RoamDecision {
  const salt = `${seed}:${obs.self.name}:roam:${obs.round}:${obs.clock}`;
  const roll = hash(salt) % 10;
  const roll2 = hash(`${salt}:b`) % 10;
  const nibbler = obs.self.role === 'nibbler';
  const madman = obs.self.role === 'madman';
  const fox = obs.self.role === 'fox';
  // 仲間は相手にしない（仲間の名前は、本人の観測に入っている）
  const awake = obs.visible.filter((v) => !v.asleep && !obs.self.allies.includes(v.name));
  const sleeper = obs.visible.find((v) => v.asleep);
  const elsewhere = () => pick(obs.rooms.filter((name) => name !== obs.where), `${salt}:room`) ?? (obs.rooms[0] as string);
  const decide = (thought: string, action: RoamDecision['action'], target: string = NO_TARGET): RoamDecision => ({ kind: 'roam', thought: `（台本）${thought}`, say: '', action, target });
  const trouble = obs.trouble ?? null;

  if (nibbler) {
    // 見つけたふりをして知らせることもある。たいていは、その場を離れる（抜け道のある部屋なら、床下から）
    if (sleeper) {
      if (roll < 3) return decide('見つけたふりをして知らせる', 'report', sleeper.name);
      const group = obs.hatches?.find((g) => g.rooms.includes(obs.where));
      const exit = pick(group?.rooms.filter((room) => room !== obs.where) ?? [], `${salt}:exit`);
      if (exit && roll < 7) return decide(`抜け道で ${exit} へ離れる`, 'sneak', exit);
      const room = elsewhere();
      return decide(`${room} へ離れる`, 'move_to', room);
    }
    // もうすぐ力が使えるなら、ふたりきりの相手を狙う。3人以上いる時は、たまにだけ無理をする
    if ((obs.napCooldown ?? 99) <= 3 && awake.length > 0) {
      const target = pick(awake, `${salt}:target`) as (typeof awake)[number];
      const action = awake.length === 1 || roll >= 2 ? 'transform_if_unseen' : 'transform';
      return decide(`${target.name} をずんだ餅に変える`, action, target.name);
    }
    if (obs.sabotage) {
      // ふたりきりになれそうな部屋の戸を閉める
      const canShut = obs.sabotage.doorWaitSeconds === 0 && obs.sabotage.doorRooms.includes(obs.where) && !(obs.shutRooms ?? []).includes(obs.where);
      if (canShut && awake.length === 1 && (obs.napCooldown ?? 99) <= 8 && roll2 < 5) return decide(`${obs.where} の戸を閉める`, 'sabotage', obs.where);
      if (!trouble && obs.sabotage.waitSeconds === 0 && roll2 < 4) {
        return roll2 < 2 ? decide('あかりを消す', 'sabotage', SABOTAGE_LIGHTS) : decide('かまどを焚きすぎにする', 'sabotage', SABOTAGE_CRISIS);
      }
    }
    if (trouble && roll < 3) return decide('直しに行って見せる', 'fix');
  } else if (madman) {
    // 妖精びいき: 見つけても、たいていは知らせない。困りごとは、目立たない程度にだけ直しに行く
    if (sleeper && roll < 3) return decide(`ずんだ餅になった ${sleeper.name} を知らせる（疑われないように）`, 'report', sleeper.name);
    if (sleeper) {
      const room = elsewhere();
      return decide(`見なかったことにして ${room} へ`, 'move_to', room);
    }
    if (trouble?.kind === 'crisis' && roll < 4) return decide('かまどを直しに行くふりをする', 'fix');
    if (trouble?.kind === 'lights' && roll < 2) return decide('あかりを直しに行くふりをする', 'fix');
  } else if (fox) {
    // 狐: 起きたまま試合が終わればよい。たいていは知らせる（妖精がクビになれば早く終わる）。ひとりきりを避けて、人のそばにいる
    if (sleeper && roll < 7) return decide(`ずんだ餅になった ${sleeper.name} を知らせる`, 'report', sleeper.name);
    if (sleeper) {
      const room = elsewhere();
      return decide(`かかわらないように ${room} へ`, 'move_to', room);
    }
    if (trouble?.kind === 'crisis' && roll < 3) return decide('かまどを直しに行くふりをする', 'fix');
    const buddy = pick(awake, `${salt}:buddy`);
    if (buddy && awake.length <= 2 && roll < 5) return decide(`${buddy.name} のそばにいる`, 'follow', buddy.name);
  } else {
    if (sleeper) return decide(`ずんだ餅になった ${sleeper.name} を知らせる`, 'report', sleeper.name);
    // 決め手になることを目の前で見たら、鐘を鳴らしに行く
    const decisive = obs.events.some((event) => event.includes('に手をかざし') || event.includes('床下の抜け道'));
    if (decisive && obs.bell && obs.bell.usesLeft > 0 && obs.bell.waitSeconds === 0 && !trouble) return decide('見たことを知らせに、鐘を鳴らしに行く', 'call_meeting');
    if (trouble?.kind === 'crisis') return decide('かまどを落ち着かせに行く', 'fix');
    if (trouble?.kind === 'lights' && roll < 6) return decide('あかりを直しに行く', 'fix');
  }

  // 仕込み。妖精と妖精びいきは、ふりをしたり、人を探して歩いたりする
  if (openDuties(obs).length > 0 && ((!nibbler && !madman && !fox) || roll < 6)) return decide(nibbler || madman || fox ? '仕込みのふりをする' : '仕込みを進める', 'do_task');

  const someone = pick(awake, `${salt}:who`);
  if (someone && roll < 3) return decide(`${someone.name} についていく`, 'follow', someone.name);
  if (roll === 9) return decide('少し待つ', 'wait');
  const room = elsewhere();
  return decide(`${room} を見に行く`, 'move_to', room);
}
