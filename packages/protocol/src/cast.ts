// 登場人物。色の名前をもらった、丸いずんだ餅の12人（絵は packages/viewer/src/actors.ts、色は theme.ts）。
// 人柄（persona）と遊び方の癖（style）は、AI の頭脳をつないだ時に渡すためのもの。台本ボットは使わない。
//
// 並びの前から人数ぶんが、試合に出る（既定は11人）。

export interface CastMember {
  /** 試合の中の呼び名。 */
  name: string;
  /** 正式な名前（クレジットや説明に使う）。 */
  fullName: string;
  /** 頭脳に渡す「口調」。人柄と話し方。 */
  persona: string;
  /** 頭脳に渡す「遊び方の癖」。疑い方・投票の決め方・動き方。役職の目的より先には立たない。 */
  style: string;
}

export const CAST: readonly CastMember[] = [
  { name: 'あかね', fullName: 'あかね', persona: '元気いっぱいで声が大きい。思ったことをすぐ口に出す', style: '怪しいと思ったら、すぐに名指しする。動きも速い' },
  { name: 'あおい', fullName: 'あおい', persona: '落ち着いていて、ていねいに話す。几帳面', style: '誰がいつどこにいたかを覚えておいて、話の食い違いを探す' },
  { name: 'みどり', fullName: 'みどり', persona: 'おっとりしていて、ずんだ餅が大好き', style: 'みんなの話を聞いてから決める。困りごとが起きると直しに行く' },
  { name: 'きいろ', fullName: 'きいろ', persona: '明るくて、冗談が好き', style: '直感で動く。間違いと分かれば、すぐに引っ込める' },
  { name: 'こはく', fullName: 'こはく', persona: '口数が少なく、短く話す', style: '見たことだけを短く言う。人の話に流されない' },
  { name: 'すみれ', fullName: 'すみれ', persona: 'お嬢さま風で、上品な言葉づかい', style: '勘を口にするが、最後は多数の意見に合わせがち' },
  { name: 'ひすい', fullName: 'ひすい', persona: 'クールで、少し皮肉っぽい', style: '根拠の弱い意見には、辛口で突っ込む' },
  { name: 'つゆくさ', fullName: 'つゆくさ', persona: '人見知りで、ためらいながら話す', style: 'ほかの人の意見を聞いてから乗る。ひとりの場所は苦手' },
  { name: 'もえぎ', fullName: 'もえぎ', persona: 'がんばり屋で、人を応援するのが好き', style: '黙っている人に話を振って、みんなを巻き込む' },
  { name: 'あさぎ', fullName: 'あさぎ', persona: 'マイペースで、気さくに話す', style: '気になった点は、納得するまで聞き返す' },
  { name: 'さくら', fullName: 'さくら', persona: 'やさしくて、面倒見がいい', style: '疑われた人の言い分も聞いてから決める' },
  { name: 'やまぶき', fullName: 'やまぶき', persona: '職人気質で、仕事にきびしい', style: '働かずにうろうろしている人を見逃さない' },
];

/**
 * 登場人物どうしの間柄（親密度）。from から見た to への気持ちで、level は 1〜5（5 がいちばん親しい）。
 * ここに無い組は、ふつうの仕事仲間として扱う。AI の頭脳をつないだ時に渡す（台本ボットは使わない）。
 */
export interface Bond {
  from: string;
  to: string;
  level: 1 | 2 | 3 | 4 | 5;
  note: string;
  /** 画面に出す短い言葉（from から to へ）。 */
  tag?: string;
}

export const BONDS: readonly Bond[] = [];

/** 「仲のよさ」の札に出す組（いまは無し）。札の言葉は BONDS の tag。 */
export const BOND_SHOWCASE: readonly { title: string; members: readonly string[]; ranks?: readonly string[] }[] = [];

export interface BondCard {
  title: string;
  members: string[];
  ranks: string[] | null;
  /** members の中の向きつきの札（from から to へ）。 */
  tags: { from: string; to: string; level: number; tag: string }[];
}

/** この試合に出ている人だけで作れる「仲のよさ」の札。 */
export function bondCards(present: readonly string[]): BondCard[] {
  return BOND_SHOWCASE.filter((card) => card.members.every((name) => present.includes(name))).map((card) => ({
    title: card.title,
    members: [...card.members],
    ranks: card.ranks ? [...card.ranks] : null,
    tags: BONDS.filter((bond) => bond.tag && card.members.includes(bond.from) && card.members.includes(bond.to)).map((bond) => ({ from: bond.from, to: bond.to, level: bond.level, tag: bond.tag as string })),
  }));
}

/** 本人から見た間柄（観測に入れる形）。 */
export interface BondView {
  name: string;
  level: number;
  note: string;
}

/** name から見た、present（この試合に出ている人）との間柄。親密度の高い順。 */
export function bondsOf(name: string, present: readonly string[]): BondView[] {
  return BONDS.filter((bond) => bond.from === name && bond.to !== name && present.includes(bond.to))
    .map((bond) => ({ name: bond.to, level: bond.level, note: bond.note }))
    .sort((a, b) => b.level - a.level);
}

/** 案内役。試合には出ず、ぜんぶを知っている立場で、場面のあいだに一言だけ話す。 */
export const NAVIGATOR: Omit<CastMember, 'style'> = {
  name: '案内役',
  fullName: '案内役',
  persona: '工房の案内役。短く、明るく話す',
};

export function castMember(name: string): CastMember | undefined {
  return CAST.find((member) => member.name === name);
}
