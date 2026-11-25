// 試合の場面の中で、案内役が言う一言（記録にある事実だけ）。

import type { MatchLog } from './match-core.ts';

/** 案内役の名前（画面の帯の札に出す）。 */
export const NARRATOR = '案内役';

const join = (names: readonly string[]) => names.join('と');

/**
 * 試合の場面の中で、案内役が言う一言（記録の事実だけ）。上映の時間軸に置き、
 * secret の一言は、役職を明かす（人狼がねらっている、など）。役職を見せている時だけ鳴らす。
 * event は log.events の何番目の出来事に付けるか、delay はその出来事から何秒あとに言いたいか。
 */
export interface Callout {
  key: string;
  text: string;
  event: number;
  delay: number;
  secret: boolean;
  /** 見回りの中の一言か（集会・試合の終わりの一言は false）。 */
  roam: boolean;
  /** event が登場人物の声（chat）で、その声への一言か。その声が鳴らない時は、一言も出さない。 */
  onChat?: boolean;
  /** 同じ印の一言は、試合の中で最初に鳴った1つだけ出す。 */
  once?: string;
  /** その声を、同じ瞬間のほかの声より先に鳴らす（一言が付いて意味が分かるように）。 */
  lift?: boolean;
}

const SIDE_NAME: Record<string, string> = { artisan: '従業員', nibbler: '人狼', fox: '妖狐' };

export function calloutsOf(log: MatchLog): Callout[] {
  const out: Callout[] = [];
  const wolfNames = new Set(log.players.filter((p) => p.role === 'nibbler').map((p) => p.name));
  const roam = (key: string, text: string, event: number, delay: number, secret: boolean) => out.push({ key, text, event, delay, secret, roam: true });
  const meet = (key: string, text: string, event: number, delay: number) => out.push({ key, text, event, delay, secret: false, roam: false });
  const voted = new Set<number>();
  log.events.forEach((event, i) => {
    // 「〇〇をねらっている」「あとをつけている」は、画面に内心が出ていない時に意味が分からないので言わない
    if (event.type === 'nap') {
      const saw = event.witnesses.filter((w) => w.sawWho).map((w) => w.name);
      // 仲間の人狼に見られても、ばれたことにはならない
      const outsiders = saw.filter((name) => !wolfNames.has(name));
      const half = event.witnesses.filter((w) => !w.sawWho && !wolfNames.has(w.name)).map((w) => w.name);
      const tail =
        outsiders.length > 0
          ? `しかも、${join(outsiders.slice(0, 2))}に見られていた！`
          : half.length > 0
            ? `${join(half.slice(0, 2))}が見ていたけど、誰がやったかは見えていない。`
            : saw.length > 0
              ? `見ていたのは、仲間の${join(saw.slice(0, 2))}だけ。`
              : '';
      roam(`nap:${i}`, `${event.target}が、ずんだ餅にされちゃった！${tail}`, i, 0.45, false);
    } else if (event.type === 'nap_failed') {
      // 妖狐に杖をふったが、餅にならなかった（役職を明かす一言なので、役職を見せている時だけ鳴らす）
      roam(`miss:${i}`, `${event.by}が${event.target}に杖をふった……でも、餅にならない！妖狐には、人狼の杖が効かない！`, i, 0.45, true);
    } else if (event.type === 'sneak' && event.phase === 'out') {
      // 抜け道から出てくる所を、人狼でない人に見られた（人狼が誰かを明かす一言なので、役職を見せている時だけ鳴らす）
      const eyes = event.witnesses.filter((name) => !wolfNames.has(name));
      if (eyes.length > 0) roam(`seen:${i}`, `${event.by}が、抜け道から出てきた！その瞬間を、${join(eyes.slice(0, 2))}が見ていた！`, i, 0.05, true);
    } else if (event.type === 'divine') {
      // 占いの結果は、占い師にだけ分かる（役職を明かす一言なので、役職を見せている時だけ鳴らす）
      if (event.cursed) roam(`divine:${i}`, `${event.by}が占ったら、${event.target}がずんだ餅に！${event.target}は、妖狐だった！`, i, 0.45, true);
      else if (event.fairy) roam(`divine:${i}`, `${event.by}が、${event.target}を占った。結果は……人狼！`, i, 0.45, true);
      else roam(`divine:${i}`, `${event.by}が、${event.target}を占った。人狼ではなかった。`, i, 0.45, true);
    } else if (event.type === 'sabotage') {
      // 画面に大きな知らせが出る妨害だけ。戸・直した・抜け道は、画面の表示に任せる
      if (event.what === 'lights') roam(`sab:${i}`, `${event.by}が、あかりを消した！`, i, 0.3, true);
      else if (event.what === 'crisis') roam(`sab:${i}`, `${event.by}が、かまどを焚きすぎにした！`, i, 0.3, true);
    } else if (event.type === 'meeting_start') {
      // 誰が何を見つけたかは画面の上の札に出るので、声は短く
      const text = event.kind === 'report' ? '見つかった！集会だよ！' : '鐘が鳴った！集会だよ！';
      meet(`call:${event.meeting}`, text, i, 0.35);
    } else if (event.type === 'vote') {
      if (voted.has(event.meeting)) return;
      voted.add(event.meeting);
      meet(`vote:${event.meeting}`, '投票の時間！みんな、誰に入れる……？', i, 0.1);
    } else if (event.type === 'meeting_end') {
      // 票の数と、人狼だったかどうかは画面の札に出るので、声では読み上げない。開票の間を無音にしないよう、ひと声だけ
      if (event.tally.some((t) => t.target !== '' && t.count > 0)) meet(`tally:${event.meeting}`, '開票……！', i, 0.3);
      const verdict = event.ejected ? `${event.ejected}は、クビ！` : '今回は、誰もクビにならなかった。';
      meet(`verdict:${event.meeting}`, verdict, i, 0.25);
    } else if (event.type === 'game_over') {
      const fox = log.players.filter((p) => p.role === 'fox').map((p) => p.name);
      meet('end', event.stolenFrom ? `試合終了！……でも、妖狐の${join(fox)}が起きている！横取りだ！` : `試合終了！${SIDE_NAME[event.winner] ?? event.winner}の勝ち！`, i, 0.4);
    }
  });
  return out;
}
