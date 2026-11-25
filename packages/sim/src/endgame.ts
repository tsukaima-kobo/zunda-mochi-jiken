// 終盤の「人数の読み」（勝てるか・負けるか・スキップしてよいか）。AI に渡す文の数え方の元になる、人数だけの小さなゲームの全探索。
//
// 前提（実際のシミュレータ roam.ts の決まりから）:
//  - 見回り（人狼が杖をふる）→ 集会（1人クビ）→ 見回り… のくり返し。見回りの終わりは、餅が見つかって知らせるか、鐘（1人1回）で集会が開かれた時。
//  - 勝ち負け（decideWinner）: 起きている人狼が0なら従業員の勝ち / 起きている人間（従業員・占い師・狂信者・妖狐。人狼でない起きている人）が人狼の人数以下なら人狼の勝ち。
//    終わった時に妖狐が起きていれば（仕込みの条件なしの試合）、どちらの勝ちでも、妖狐の勝ちに替わる（finish）。
//  - 妖狐には杖が効かない。人狼は、従業員か狂信者を餅にできる。狂信者は人間に数える（人狼の味方）。
//  - 見回り1回で餅になる人数は、人狼1人につき1人（k=1: 見回りごとに人狼全体で1人 / k=each: 人狼1人につき1人）。実際の記録は、1〜2人（人狼2人でも1人の見回りが多い）。
//  - 人狼は、仕込みが終わる前に勝たなければならないので、毎回の見回りで、1人以上を餅にする（餅にしない見回りをくり返すと、従業員の仕込みが終わる）と数える。
//  - 従業員側は、完全な情報があれば、集会で好きな相手（従業員・狂信者・妖狐・人狼）かスキップを選べる、と数える（上限の見積もり。本物の AI は、誰が誰か分からない）。
//  - 数えない（人数だけでは決まらないもの）: 鐘で見回りの初めに集会を開く手と、それを止める妨害（あかり・かまど）の早い者勝ち／仕込みが全部終わる勝ち（従業員の仕込みは、餅になっても心だけで続く）／かまどの焚きすぎ（人狼の勝ち）／票が割れて誰もクビにならない場合。

export type EndSide = 'crew' | 'wolf' | 'fox';

/** 起きている人の内訳。crew は従業員側（従業員・占い師）、madmen は狂信者、fox は妖狐（0か1）、wolves は人狼。 */
export interface EndCount {
  crew: number;
  madmen: number;
  fox: number;
  wolves: number;
}

/** 見回り1回で餅になる人数: one = 人狼全体で1人 / each = 人狼1人につき1人。 */
export type NapsPerPatrol = 'one' | 'each';

/** 集会で選べるもの。 */
export type EjectChoice = 'crew' | 'madman' | 'fox' | 'wolf' | 'skip';

/** 試合が終わっているか（終わっていれば、勝ったのは誰か。妖狐が起きていれば妖狐）。 */
export function endOf(c: EndCount): EndSide | null {
  if (c.wolves <= 0) return c.fox > 0 ? 'fox' : 'crew';
  if (c.crew + c.madmen + c.fox <= c.wolves) return c.fox > 0 ? 'fox' : 'wolf';
  return null;
}

const WOLF_PREFERS: Record<EndSide, number> = { wolf: 0, fox: 1, crew: 2 };
const CREW_PREFERS: Record<EndSide, number> = { crew: 0, fox: 1, wolf: 2 };

/** 見回りの始まりの局面から、最後に勝つのは誰か（人狼は最善を尽くし、従業員は集会で最善を選ぶ）。 */
export function patrolOutcome(c: EndCount, naps: NapsPerPatrol = 'one', memo = new Map<string, EndSide>()): EndSide {
  const key = `p${naps}:${c.crew},${c.madmen},${c.fox},${c.wolves}`;
  const known = memo.get(key);
  if (known) return known;
  const most = naps === 'one' ? 1 : c.wolves;
  let best: EndSide | null = null;
  for (let total = 1; total <= most; total++) {
    for (let m = 0; m <= Math.min(c.madmen, total); m++) {
      const w = total - m;
      if (w > c.crew) continue;
      const cur = { ...c };
      let result: EndSide | null = null;
      for (let i = 0; i < w && !result; i++) {
        cur.crew -= 1;
        result = endOf(cur);
      }
      for (let i = 0; i < m && !result; i++) {
        cur.madmen -= 1;
        result = endOf(cur);
      }
      const side = result ?? meetingBest(cur, naps, memo);
      if (best === null || WOLF_PREFERS[side] < WOLF_PREFERS[best]) best = side;
    }
  }
  const out = best ?? 'crew';
  memo.set(key, out);
  return out;
}

/** 集会で、それぞれを選んだ時の結果。 */
export function meetingOutcomes(c: EndCount, naps: NapsPerPatrol = 'one', memo = new Map<string, EndSide>()): Partial<Record<EjectChoice, EndSide>> {
  const out: Partial<Record<EjectChoice, EndSide>> = {};
  const options: EjectChoice[] = [];
  if (c.crew > 0) options.push('crew');
  if (c.madmen > 0) options.push('madman');
  if (c.fox > 0) options.push('fox');
  if (c.wolves > 0) options.push('wolf');
  options.push('skip');
  for (const choice of options) {
    const next = { ...c };
    if (choice === 'crew') next.crew -= 1;
    if (choice === 'madman') next.madmen -= 1;
    if (choice === 'fox') next.fox -= 1;
    if (choice === 'wolf') next.wolves -= 1;
    out[choice] = endOf(next) ?? patrolOutcome(next, naps, memo);
  }
  return out;
}

function meetingBest(c: EndCount, naps: NapsPerPatrol, memo: Map<string, EndSide>): EndSide {
  let best: EndSide | null = null;
  for (const side of Object.values(meetingOutcomes(c, naps, memo))) {
    if (best === null || CREW_PREFERS[side] < CREW_PREFERS[best]) best = side;
  }
  return best ?? 'wolf';
}

/** 集会の始まり（餅が出たあと）の局面で、従業員が完全な情報で勝てる選び方があるか。 */
export function crewCanWinAtMeeting(c: EndCount, naps: NapsPerPatrol = 'one'): boolean {
  return Object.values(meetingOutcomes(c, naps)).includes('crew');
}

/**
 * 公開の情報（起きている人数・残っている人狼の数・妖狐がまだ起きているかもしれないか）から読む、終盤の局面。
 * 狂信者が起きているかどうかは公開されないが、結果は起きている人数だけで決まる（狂信者がいても、従業員の数が1人減るだけ）。
 * E = 人狼の数 ＋ 妖狐（クビにしないといけない相手の数）。見回りで1人ずつ餅になり、集会で1人ずつクビにできる、として数える。
 */
export interface EndgameOutlook {
  /** 集会の始まり: free = スキップしても、まだ勝ち目が残る / last = ここで正しい相手をクビにしないと、もう勝てない / lost = もう勝てない（完全な情報があっても）。 */
  meeting: 'free' | 'last' | 'lost';
  /**
   * 集会で使える余裕（回数）。スキップは1回ぶん、従業員（人狼でも妖狐でもない人）を間違ってクビにすると2回ぶん使う。
   * 妖狐が起きている間に最後の人狼をクビにすると、余裕に関係なく負ける（妖狐の横取り）。
   */
  skips: number;
  /** 見回りの始まり: 餅が出て集会が開かれるまでに、もう勝てなくなっているか（鐘を早く鳴らして、人狼の妨害より先に集会を開く道だけが残る）。 */
  patrolLost: boolean;
}

export function endgameOutlook(awake: number, wolves: number, foxUp: boolean, naps: NapsPerPatrol = 'one'): EndgameOutlook {
  const evil = wolves + (foxUp ? 1 : 0);
  // 人狼が2人以上いて、見回り1回に1人ずつ（each）餅にできる時は、余裕が人狼の数−1だけ減る（全探索で確かめたのは、人狼2人まで）
  const last = 2 * evil + 1 + (naps === 'each' ? Math.max(0, wolves - 1) : 0);
  return {
    meeting: awake > last ? 'free' : awake > 2 * evil ? 'last' : 'lost',
    skips: Math.max(0, awake - last),
    patrolLost: awake <= last,
  };
}

/** 局面の人数の組み立て（試験と検算用）: 全員の数 = 従業員側 + 狂信者 + 妖狐 + 人狼。 */
export function countOf(crew: number, madmen: number, fox: number, wolves: number): EndCount {
  return { crew, madmen, fox, wolves };
}

/**
 * 手がかりが全く無い時（占い師がいない・何の情報も無い）の、従業員側が勝つ確率。投票する人は、本人以外の起きている人から、一様に1人を選び、全員の票がそろって、その人がクビになる、と数える
 * （上限の見積もり。本物の集会では、話し合いの手がかりで、当てずっぽうよりよく選べる）。見回りでは、人狼が従業員を1人（each なら人狼1人につき1人）餅にする。
 * vote: いま誰かに入れる（以降は、最善に選ぶ） / skip: スキップして次の見回りへ（以降は、最善に選ぶ）。
 */
export function blindChances(crew: number, fox: number, wolves: number, naps: NapsPerPatrol = 'one'): { vote: number; skip: number } {
  const memo = new Map<string, { vote: number; skip: number }>();
  const settle = (c: number, f: number, w: number): number | null => {
    const r = endOf({ crew: c, madmen: 0, fox: f, wolves: w });
    return r === null ? null : r === 'crew' ? 1 : 0;
  };
  const patrol = (c: number, f: number, w: number): number => {
    const most = naps === 'one' ? 1 : w;
    let worst = Infinity;
    for (let j = 1; j <= most; j++) {
      let nn = c;
      let done: number | null = null;
      for (let i = 0; i < j && done === null; i++) {
        nn -= 1;
        if (nn < 0) break;
        done = settle(nn, f, w);
      }
      if (nn < 0) continue;
      worst = Math.min(worst, done ?? meeting(nn, f, w).best);
    }
    return worst === Infinity ? 0 : worst;
  };
  const after = (c: number, f: number, w: number): number => settle(c, f, w) ?? patrol(c, f, w);
  const meeting = (c: number, f: number, w: number): { vote: number; skip: number; best: number } => {
    const key = `${c},${f},${w}`;
    const known = memo.get(key);
    if (known) return { ...known, best: Math.max(known.vote, known.skip) };
    const others = c - 1 + f + w;
    let vote = 0;
    if (others > 0) {
      if (c - 1 > 0) vote += ((c - 1) / others) * after(c - 1, f, w);
      if (f > 0) vote += (f / others) * after(c, 0, w);
      vote += (w / others) * after(c, f, w - 1);
    }
    const skip = after(c, f, w);
    memo.set(key, { vote, skip });
    return { vote, skip, best: Math.max(vote, skip) };
  };
  const r = meeting(crew, fox, wolves);
  return { vote: r.vote, skip: r.skip };
}

