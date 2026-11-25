// ゲーム側（sim / server）とエージェント側（agents）のあいだを流れるデータの形。
// エージェントが受け取るのは Observation だけ、返すのは Intent だけ。
// ここには真の状態の型を置かない（真の状態は sim の中だけにある）。

import { z } from 'zod';
import type { BondView } from './cast.ts';

/**
 * 従業員 / 人狼 / 狂信者 / 妖狐 / 占い師。
 * 内部の名前 nibbler は、前の題材（つまみ食い犯）のなごり。記録の互換のために残している。
 * 狂信者（madman）は、人狼の味方をする人間。誰が人狼かを知っている（人狼は、誰が狂信者かを知らない）。
 * 妖狐（fox）は、ひとりだけの陣営。試合が終わった時に起きていれば、どちらが勝っても勝ちを横取りする
 * （自分の仕込みを決まった数（foxSteps）だけ終えていること、という条件を足すこともできる。既定は条件なし。条件がある時も、妖狐の仕込みは従業員の進み具合には入らない）。
 * 妖狐には人狼の杖が効かない。占い師に占われると、その場でずんだ餅になる。
 * 占い師（seer）は、従業員側の人間。自分の仕込みをしながら、見回り1回につき1人、そばにいる相手を占える（2026-11-21 昼に1試合に1回へ変え、同じ日の夕方に見回りごとへ戻した）。
 * 分かるのは、その相手が人狼かどうかだけ（妖狐も狂信者も「人狼ではない」と出る）。占ったことは、周りからは分からない。
 */
export type Role = 'artisan' | 'nibbler' | 'madman' | 'fox' | 'seer';

export const ROLE_LABEL: Record<Role, string> = {
  artisan: '従業員',
  nibbler: '人狼',
  madman: '狂信者',
  fox: '妖狐',
  seer: '占い師',
};

/** 勝ち負けの側。狂信者は人狼側（人狼が勝てば勝ち）。妖狐はひとりだけの陣営。占い師は従業員側。 */
export type Side = 'artisan' | 'nibbler' | 'fox';
export const SIDE_OF: Record<Role, Side> = { artisan: 'artisan', nibbler: 'nibbler', madman: 'nibbler', fox: 'fox', seer: 'artisan' };
export const SIDE_LABEL: Record<Side, string> = { artisan: '従業員', nibbler: '人狼', fox: '妖狐' };

/** この試合の顔ぶれ（役職ごとの人数。誰がどれかは入らない）。全員が知っている。古い記録には foxes・seers が無い。 */
export interface CastCounts {
  total: number;
  nibblers: number;
  madmen: number;
  foxes?: number;
  seers?: number;
  /** 妖狐が横取りするために終えておく、自分の仕込みの工程の数（全員が知っている決まり）。条件の無い試合と古い記録には無い。 */
  foxSteps?: number;
  /** 占い師が占うのに、相手のそばにいつづける秒数（全員が知っている決まり。2026-11-21 夜から）。占い師のいない試合と古い記録には無い。 */
  divineSeconds?: number;
}

/** 占い師が占った結果（本人にだけ渡す）。fairy: 人狼だった。cursed: 占った相手が、その場でずんだ餅に変わった（妖狐だった）。 */
export interface Divined {
  name: string;
  /** 何回目の見回りで占ったか。 */
  round: number;
  fairy: boolean;
  cursed?: boolean;
  /**
   * そばにいはじめた時刻と、占いが終わった時刻（試合の開始からの秒）と、終わった時の場所。占い師本人が見て知っていること。
   * 集会で「いつ・どこで占ったか」を正しく言えるように渡す（2026-11-22。本物の占い師が、自分の言った時刻や場所の食い違いでクビになっていた）。
   */
  from?: number;
  to?: number;
  room?: string;
}

/** 会議で全員に聞こえた発言。話者は表示名で表す（内部の通し番号は観測に出さない）。 */
export interface Utterance {
  round: number;
  speaker: string;
  text: string;
}

/**
 * 集会の場での番。speak: 集会で話す / vote: 投票する /
 * greet: 朝礼（最初の見回りの前に、全員がひとことずつ話す）/
 * diary: 試合のあとに日記を書く / review: 試合のあとの感想会で話す。
 * vote 以外は、どれも say を返す。
 */
export type MeetingPhase = 'speak' | 'vote' | 'greet' | 'diary' | 'review';

/** 試合が終わったあとの番（ここで初めて、全員の役職と結果が明かされる）。 */
export const AFTER_PHASES: readonly MeetingPhase[] = ['diary', 'review'];

/**
 * 会議中に1人のエージェントへ渡す観測。本人が知覚できたことだけが入る。
 * これ以外の経路で真の状態がエージェントへ渡ってはならない（試合が終わったあとの reveal だけは例外で、全員に明かす）。
 */
export interface MeetingObservation {
  kind: 'meeting';
  phase: MeetingPhase;
  self: {
    name: string;
    role: Role;
    persona: string;
    /** 遊び方の癖（本人の分だけ）。 */
    style: string;
    /** 同じ陣営だと本人が知っている相手（人狼には仲間の人狼。狂信者には人狼。人狼は、誰が狂信者かを知らない）。 */
    allies: string[];
    /** 本人から見た、ほかの人との間柄（親密度）。この試合に出ている人の分だけ。 */
    bonds?: BondView[];
    /** 占い師だけ: これまでに占った結果（古い順）。ほかの人には無い。 */
    divined?: Divined[];
    /** 妖狐だけ（横取りに仕込みの条件がある試合）: 自分の仕込みの進み（done 工程 / 要るのは need 工程）。ほかの人には無い。 */
    foxWork?: { done: number; need: number };
  };
  /** 本人がこの回に見聞きしたこと（時刻つきの短文）。 */
  facts: string[];
  /** クビになって「妖狐だった」と全員に知らされた妖狐の人数（妖狐のいる試合で、1人以上の時だけ。2026-11-21 から）。 */
  foxesOut?: number;
  /** これまでの集会の経過（全員に公開された内容だけ）。古い順。 */
  history: string[];
  meeting: {
    /** 全員に告知された、会議が開かれた理由。 */
    reason: string;
    /** 来ていない人。出席を見れば全員に分かること。 */
    absent: Absence[];
    round: number;
    maxRounds: number;
    /** 出席者の表示名。並びは全員が見ている席順。 */
    attendees: string[];
    transcript: Utterance[];
  };
  /** この試合の顔ぶれ（役職ごとの人数。誰がどれかは入らない）。全員が知っている。 */
  cast?: CastCounts | null;
  /**
   * いまの局面（全員に公開された情報だけで分かること）。awake は出席者の数、fairiesLeft は顔ぶれの人狼の数から
   * 「人狼だった」と公表された人を引いた数。lastChance は、ここで誰もクビにならないと、次に1人が餅になった時点で、従業員が勝てなくなる局面（2026-11-24 から、まだ起きているかもしれない妖狐も、クビにしないといけない相手として数える。foxUp: 妖狐が、まだ起きているかもしれない）。
   */
  stakes?: {
    awake: number;
    fairiesLeft: number;
    lastChance: boolean;
    /** 妖狐が、まだ起きているかもしれない（顔ぶれの妖狐の数から、「妖狐だった」と公表された人を引くと1以上）。 */
    foxUp?: boolean;
    /**
     * ここでスキップすると、完全な情報があっても、もう勝てない人数（見回りで1人しか餅にならない、従業員に最も有利な場合でも）。lastChance より厳しい（人狼が2人の間は、lastChance のほうが1人多く出る）。
     * ガードが、従業員のスキップを聞き直す時に使う（誤って止めないため、確実な場合だけ）。
     */
    skipFatal?: boolean;
  } | null;
  /**
   * 集会の発言の番で、話すことがなければ黙ってよいか（say を空にできる）。集会の最初の発言は黙れない。
   */
  mayPass?: boolean;
  /** speak: 疑い先の候補。vote: 投票先の候補。どちらも本人以外の出席者＋棄権の語。朝礼・日記・感想会は「なし」だけ。 */
  options: string[];
  /** 試合が終わったあと（diary / review）だけ: 結果と、全員の役職。試合の間は入らない。 */
  reveal?: { result: string; roles: { name: string; role: Role; status: string }[] } | null;
  limits: {
    /** 発言の目安の長さ（プロンプトに書く）。 */
    sayTargetChars: number;
    /** これを超えた発言は受け付けない。 */
    sayMaxChars: number;
  };
}

/** 集会に来ていない人。asleep: ずんだ餅になった（内部の名前は前の題材のなごり） / sent_home: クビになった */
export interface Absence {
  name: string;
  status: 'asleep' | 'sent_home';
}

export const ABSENCE_LABEL: Record<Absence['status'], string> = { asleep: 'ずんだ餅になった', sent_home: 'クビになった' };

export const NO_SUSPECT = 'なし';
export const SKIP_VOTE = 'スキップ';

export const SpeakIntent = z.object({
  /** 観戦者にだけ見せる内心。他のエージェントには渡さない。 */
  thought: z.string(),
  /**
   * 全員に聞こえる発言。集会の発言の番で、観測の mayPass が true の時だけ、空（黙っている）にできる。
   * 空を受け付けるかは、進行役（guard と sim の applySpeak）が確かめる。
   */
  say: z.string().trim(),
  /** いま最も疑っている相手。非公開（観戦者と本人の記憶だけ）。 */
  suspect: z.string(),
});
export type SpeakIntent = z.infer<typeof SpeakIntent>;

/** 疑い度（0: まったく疑っていない 〜 5: 人狼だと確信）。投票の時に、ほかの出席者の全員について答える。非公開（観戦者にだけ見せる）。 */
export const SUSPICION_LEVELS = [0, 1, 2, 3, 4, 5] as const;
export const SuspicionEntry = z.object({ name: z.string(), level: z.number() });
export type SuspicionEntry = z.infer<typeof SuspicionEntry>;

export const VoteIntent = z.object({
  thought: z.string(),
  vote: z.string(),
  /** 次の回のための、自分への覚え書き（誰をなぜ疑っているか）。本人の記憶にだけ残る。 */
  memo: z.string().default(''),
  suspicion: z.array(SuspicionEntry).default([]),
});
export type VoteIntent = z.infer<typeof VoteIntent>;

export type MeetingIntent = ({ kind: 'speak' } & SpeakIntent) | ({ kind: 'vote' } & VoteIntent);

/** 頭脳に渡す JSON スキーマ。選択肢は観測に入っている候補だけから作る。 */
export function intentJsonSchema(obs: MeetingObservation): Record<string, unknown> {
  const text = { type: 'string' };
  const choice = { type: 'string', enum: obs.options };
  const suspicion = {
    type: 'array',
    items: {
      type: 'object',
      properties: { name: { type: 'string', enum: obs.options.filter((option) => option !== SKIP_VOTE) }, level: { type: 'integer', enum: [...SUSPICION_LEVELS] } },
      required: ['name', 'level'],
      additionalProperties: false,
    },
  };
  const properties =
    obs.phase === 'vote' ? { thought: text, vote: choice, memo: text, suspicion } : { thought: text, say: text, suspect: choice };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

/** 頭脳1回の呼び出しで使った量。提供元によって取れない項目は null。 */
export interface BrainUsage {
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  /** CLI が返す API 換算の概算額（請求額ではない）。 */
  apiEquivalentUsd: number | null;
}

/** 意図がどこから来たか。brain: 1回目の応答 / retry: 聞き直しの応答 / trimmed: 長すぎて切った / fallback: 台本の代用。 */
export type IntentSource = 'brain' | 'retry' | 'trimmed' | 'fallback';

/** 追記専用の記録（ジャーナル）の1行。枠切れで止まっても、ここから再開できるようにするためのもの。 */
export type JournalEntry =
  | { type: 'match_start'; matchId: string; seed: number; config: unknown; players: unknown }
  | {
      type: 'request';
      turn: number;
      agent: string;
      attempt: number;
      brain: string;
      system: string;
      user: string;
      schema: unknown;
    }
  | {
      type: 'response';
      turn: number;
      agent: string;
      attempt: number;
      brain: string;
      ok: boolean;
      json: unknown;
      problems: string[];
      usage: BrainUsage | null;
      latencyMs: number;
    }
  | { type: 'apply'; turn: number; agent: string; source: IntentSource; intent: AnyIntent; note?: string }
  | { type: 'match_end'; result: unknown };

export type StampedJournalEntry = JournalEntry & { seq: number; at: string };

// ───────── 歩き回る時間 ─────────

/** 見回りの間に1回で話せる長さ（字）の目安と上限。 */
export const ROAM_SAY_TARGET_CHARS = 35;
export const ROAM_SAY_MAX_CHARS = 60;

/** 対象を取らない行動（wait）のときに target に入れる語。 */
export const NO_TARGET = 'なし';

/**
 * 歩き回っている間に1人のエージェントへ渡す観測。
 * 入るのは、本人の状態、いま本人の視界に入っているもの、全員に公開されたことだけ。座標は渡さない。
 */
export interface RoamObservation {
  kind: 'roam';
  /** foxWork: 妖狐だけ。横取りの条件の、自分の仕込みの進み（done 工程 / 要るのは need 工程）。条件の無い試合には無い。 */
  self: { name: string; role: Role; persona: string; style: string; allies: string[]; bonds?: BondView[]; divined?: Divined[]; foxWork?: { done: number; need: number } };
  /** 何回目の見回りか（集会のたびに1つ進む）。 */
  round: number;
  /** 開始からの秒数（集会の間は止まる）。全員が同じ時計を見ている。 */
  clock: number;
  /** 開店までの残り秒数（全員が知っている）。 */
  secondsUntilOpening: number;
  /** いまいる場所の名前（部屋か通路）。 */
  where: string;
  /**
   * いま見えている相手。並びは名簿順（全員が知っている並び）。asleep はずんだ餅になっている。working は持ち場で手を動かしている。
   * checking は、工房の道具（シフト表など）を見ている時の、その道具の名前。
   */
  visible: { name: string; where: string; asleep: boolean; working?: boolean; checking?: string }[];
  /** 自分の仕込み（本人だけが知っている）。steps は回る順。 */
  duties?: RoamDuty[];
  /** まだ出ていない自分の仕込みの数（仕込みを少しずつ出す試合だけ。1つ終えるたびに1つ出る。2026-11-21 夜から）。 */
  dutiesWaiting?: number;
  /** 工房全体の仕込みの進み具合（全員に見えている）。仕込みの無いマップでは null。 */
  taskBar?: { done: number; total: number } | null;
  /** いま起きている困りごと（全員が気づく）。無ければ null。 */
  trouble?: RoamTrouble | null;
  /** 戸が閉まっていると本人に分かる部屋（その部屋にいるか、閉まった戸が見えている）。 */
  shutRooms?: string[];
  /** 中庭の鐘（みんなを集める）。usesLeft は自分があと何回鳴らせるか、waitSeconds は鳴らせるようになるまでの秒数。鐘の無いマップでは null。 */
  bell?: { usesLeft: number; waitSeconds: number } | null;
  /** 人狼だけ: 妨害。waitSeconds は次に妨害できるまで、doorWaitSeconds は次に戸を閉められるまでの秒数。従業員は null。 */
  sabotage?: { waitSeconds: number; doorWaitSeconds: number; doorRooms: string[] } | null;
  /** 人狼だけ: 床下の抜け道。同じ組の部屋どうしがつながっている。従業員は null。 */
  hatches?: { group: string; rooms: string[] }[] | null;
  /** 工房の道具（誰でも見に行ける。全員が知っている）。kind: admin シフト表 / vitals ずんだ餅ボード / cameras 防犯カメラの画面。 */
  devices?: RoamDevice[];
  /** 防犯カメラの画面を見ている間だけ: カメラごとに、いま映っている人。見ていなければ null。 */
  cameraView?: { place: string; seen: { name: string; asleep: boolean }[] }[] | null;
  /** 赤いランプのついた防犯カメラのうち、本人から見えているもの（誰かが画面を見ている）。 */
  cameraLit?: string[];
  /** この瞬間に本人が見聞きした出来事（状態の見比べでは分からないもの）。 */
  events: string[];
  /**
   * この瞬間に聞こえた声（自分の声も入る）。声は、近くにいて、あいだに壁の無い人にだけ届く（暗くても届く）。
   * where は話した人のいた場所。姿が見えなかった時は null。
   */
  heard?: { speaker: string; text: string; where: string | null }[];
  /** 次に話せるまでの秒数（0 なら話せる）。 */
  chatWaitSeconds?: number;
  /** 自分がいましていること。 */
  activity: string;
  /** 続けている行動が無い（次の行動を決める必要がある）。 */
  idle: boolean;
  /** 直前の行動の結果。まだ無ければ null。本人の行動だけから作った文。 */
  lastResult: string | null;
  /** 人狼だけ: 次に人をずんだ餅に変えられるまでの秒数（0 なら変えられる）。ほかの人は null。 */
  napCooldown: number | null;
  /** 占い師だけ: 占い。usesLeft は、この見回りであと何回占えるか（見回り1回につき1人）。ほかの人は null か無い。 */
  divine?: { usesLeft: number } | null;
  /** 行き先にできる場所（部屋と廊下。全員が知っている）。 */
  rooms: string[];
  /** 工房の間取り（全員が知っている）。「場所: 隣り合っていて歩いて移れる場所」の行。 */
  layout: string[];
  /** 工房のいちばん離れた場所どうしを歩く時の、おおよその秒数（全員が知っている）。 */
  crossSeconds: number;
  /** 全員の名前（名簿順）。 */
  roster: string[];
  /** この試合の顔ぶれ（役職ごとの人数。誰がどれかは入らない）。全員が知っている。 */
  cast?: CastCounts | null;
  /** もう工房にいないと全員が知っている人（集会で分かったこと）。 */
  away: Absence[];
  /** クビになって「妖狐だった」と全員に知らされた妖狐の人数（妖狐のいる試合で、1人以上の時だけ。2026-11-21 から）。 */
  foxesOut?: number;
  /** これまでの集会の経過（全員に公開された内容だけ）。古い順。 */
  history: string[];
}

export interface RoamDuty {
  name: string;
  /** 終えた工程と、いまの工程（次の工程の場所は、いまの工程を終えるまで分からない。2026-11-21 から）。 */
  steps: { what: string; room: string; done: boolean }[];
  /** この仕込みの工程の数（steps に無い先の工程も数える）。古い記録には無い。 */
  total?: number;
}

export type DeviceKind = 'admin' | 'vitals' | 'cameras';

export interface RoamDevice {
  kind: DeviceKind;
  /** 道具の名前（check の target）。 */
  name: string;
  /** 置いてある部屋。 */
  room: string;
}

export interface RoamTrouble {
  kind: 'lights' | 'crisis';
  /** crisis のときだけ: 残り秒数。 */
  secondsLeft: number | null;
  /** 直す場所。held は、いま誰かがついている（crisis は全部に同時に人がつくと直る）。 */
  fixAt: { name: string; room: string; held: boolean }[];
}

/** 妨害の target に入れる語（部屋の名前を入れると、その部屋の戸を閉める）。 */
export const SABOTAGE_LIGHTS = 'あかり';
export const SABOTAGE_CRISIS = 'かまど';

/**
 * 誰でもできる行動。report は、見えている、ずんだ餅になった人を知らせて集会を開く。
 * do_task は自分の仕込みを進める。fix は困りごとを直しに行く。call_meeting は中庭の鐘を鳴らしに行く。
 * check は工房の道具（シフト表・ずんだ餅ボード・防犯カメラの画面）を見に行く。
 */
export const ROAM_ACTIONS = ['move_to', 'follow', 'wait', 'report', 'do_task', 'fix', 'call_meeting', 'check'] as const;
/** 人狼だけができる行動。transform は人をずんだ餅に変える。transform_if_unseen は、ほかの誰にも見られていない時だけ変える。 */
export const NIBBLER_ACTIONS = ['transform', 'transform_if_unseen', 'sneak', 'sabotage'] as const;
/** 占い師だけができる行動。divine は、見えている相手に近づいて占う（人狼かどうかが、本人にだけ分かる）。 */
export const SEER_ACTIONS = ['divine'] as const;
export const ALL_ROAM_ACTIONS = [...ROAM_ACTIONS, ...NIBBLER_ACTIONS, ...SEER_ACTIONS] as const;
export type RoamAction = (typeof ALL_ROAM_ACTIONS)[number];

export const RoamIntent = z.object({
  /** 観戦者にだけ見せる内心。 */
  thought: z.string(),
  /** 声に出して言うこと（近くの人にだけ聞こえる）。言わない時は空。 */
  say: z.string().default(''),
  action: z.enum(ALL_ROAM_ACTIONS),
  /** move_to: 部屋の名前 / follow・report・transform・divine: いま見えている相手の名前 / do_task: 仕込みの名前か「なし」 / fix: 直す場所の名前か「なし」 / check: 道具の名前 / wait・call_meeting: 「なし」 */
  target: z.string(),
});
export type RoamIntent = z.infer<typeof RoamIntent>;

/** 本人が選べる行動。役職で変わる（スキーマは本人にしか渡らない）。 */
export function roamActions(obs: RoamObservation): RoamAction[] {
  // 道具の無い工房では、check は出さない
  const common = (obs.devices ?? []).length > 0 ? [...ROAM_ACTIONS] : ROAM_ACTIONS.filter((a) => a !== 'check');
  if (obs.self.role === 'nibbler') return [...common, ...NIBBLER_ACTIONS];
  // 占い師は、占える時だけ（この試合でもう占ったあとは、選べる行動に出さない）
  return obs.self.role === 'seer' && (obs.divine?.usesLeft ?? 0) > 0 ? [...common, ...SEER_ACTIONS] : common;
}

/** まだ終わっていない自分の仕込みの名前。 */
export function openDuties(obs: RoamObservation): string[] {
  return (obs.duties ?? []).filter((duty) => duty.steps.some((step) => !step.done)).map((duty) => duty.name);
}

/** 本人が target に書ける語。役職で変わる（スキーマは本人にしか渡らない）。 */
export function roamTargets(obs: RoamObservation): string[] {
  const targets = [
    ...obs.rooms,
    ...obs.visible.map((v) => v.name),
    ...openDuties(obs),
    ...(obs.trouble?.fixAt.map((f) => f.name) ?? []),
    ...(obs.sabotage ? [SABOTAGE_LIGHTS, SABOTAGE_CRISIS] : []),
    ...(obs.devices ?? []).map((d) => d.name),
    NO_TARGET,
  ];
  return [...new Set(targets)];
}

export function roamIntentJsonSchema(obs: RoamObservation): Record<string, unknown> {
  const properties = {
    thought: { type: 'string' },
    say: { type: 'string' },
    action: { type: 'string', enum: roamActions(obs) },
    target: { type: 'string', enum: roamTargets(obs) },
  };
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

export type Observation = MeetingObservation | RoamObservation;
export type AnyIntent = MeetingIntent | ({ kind: 'roam' } & RoamIntent);

export { BOND_SHOWCASE, BONDS, bondCards, bondsOf, CAST, castMember, NAVIGATOR } from './cast.ts';
export type { Bond, BondCard, BondView, CastMember } from './cast.ts';
