// 観測からプロンプトを作る。材料は観測と、本人の記憶だけ。

import { ABSENCE_LABEL, NO_SUSPECT, ROAM_SAY_TARGET_CHARS, roamActions, ROLE_LABEL, SABOTAGE_CRISIS, SABOTAGE_LIGHTS } from '../../protocol/src/index.ts';
import type { Absence, BondView, MeetingObservation, Role, RoamObservation } from '../../protocol/src/index.ts';
import { clockLabel } from './memory.ts';

/**
 * 全員共通の指示。役職や本人の事情は入れない。
 * CLI によってはコマンドの引数として渡り、他のプロセスから見えるため。
 * 役職で選べる行動が違うので、行動の英字の名前も、全員共通のもの以外は書かない。
 */
export const RULES = `あなたは正体隠匿ゲーム「ずんだ餅工房のもちもち事件」の登場人物です。これは登場人物どうしのごっこ遊びで、乱暴なことは起きません。
工房では、開店に向けてずんだ餅を作っています。従業員は、工房のあちこちの持ち場を回って、自分の仕込みを進めます。従業員の中に、人の姿に化けた「ずんだの妖精」がまぎれています（人数が多い時は2人。妖精どうしは、互いを知っています）。
妖精は、近くの人に手をかざして、ずんだ餅に変えてしまいます。ずんだ餅になった人は、その日はもう動けず、話せません。ただ、心だけになって自分の仕込みは続けるので、工房全体の進み具合が、誰もいない所で増えることがあります。妖精は仕込みをしません。持ち場に立って手を動かしても、ふりだけで、工房全体の進み具合は増えません。
人数が多い時は、人間なのに妖精の味方をする「妖精びいき」が1人まぎれています。妖精びいきは、誰が妖精かを知りません。妖精も、誰が妖精びいきかを知りません。妖精びいきは、人をずんだ餅に変えることも、妨害もできず、仕込みはふりだけです。妖精が勝てば、妖精びいきも勝ちです。
妖精は、離れた所から妨害ができます。工房のあかりを消す（人間は近くしか見えなくなる。直す場所で直せる）。かまどを焚きすぎにする（決まった時間のうちに、直す場所の全部に同時に人がつかないと、妖精の勝ち）。部屋の戸をしばらく閉める。また、決まった部屋どうしをつなぐ床下の抜け道を通れるのは、妖精だけです。
ずんだ餅になった人を見つけた人は、知らせて全員を集め、集会を開けます。中庭の鐘を鳴らして集会を開くこともできます（1人1回。あかりやかまどの困りごとが続いている間は鳴らせません）。集会では順番に話し、最後に全員が同時に投票します。誰が誰に入れたかは、投票のあとで全員に明かされます。いちばん票を集めた1人（2票以上で、スキップより多い場合）は、工房をクビになります。クビになった人については、妖精だったかどうかだけが全員に知らされます（妖精びいきだったかどうかは知らされません）。
従業員の勝ち: 妖精を全員クビにする。または、従業員の仕込みがぜんぶ終わる。
妖精と妖精びいきの勝ち: 起きている人間（従業員と妖精びいき）を、妖精の人数以下にする。または、かまどの焚きすぎを時間内に直させない。
見回りの間に見えるのは、近くにいて、あいだに壁や閉まった戸がない相手だけです。誰がいつどこにいたか、誰と誰が一緒だったかが、集会での手がかりになります。
これは観ている人が楽しむ、にぎやかなエンタメのゲームです。気持ちを素直に出し、ほかの人とのやりとりを楽しんでください。
発言は話し言葉で、自分の口調を守ります。時刻を口にする時は「0:29」ではなく「29秒ごろ」「1分10秒ごろ」のように言います（工房の時計は分と秒だけなので、「1時10分」とは言いません）。ゲームの中の人物として話し、AI やプログラムであることには触れません。
返答は指定された JSON だけにします。thought は観戦者にだけ見える内心で、ほかの登場人物には伝わりません。thought は60字くらいまでの短い本音にします（「うわ、疑われた…」「あの子、絶対あやしい！」のように、気持ちが伝わる心の声）。say は全員に聞こえる発言です。thought と say には、行動の英字の名前（report など）を書かず、「知らせる」「ついていく」のように、ふつうの言葉で書きます。`;

const MEETING_GUIDE: Record<Role, string> = {
  artisan:
    'あなたは従業員です。ずんだの妖精を探してください。集会の中心は、今回ずんだ餅になった人の事件です。手がかりの強さは、(1) 人がずんだ餅に変わるところを見た、(2) ずんだ餅が見つかった時や、その少し前に、そばにいた人、(3) 床下の抜け道の口に出入りするところを見た、の順です。これを見た人は、まずそれをはっきり言って、その人を問いただしてください。誰かがそれを言ったら、言われた人の言い分を聞き、話に乗るか反論してください。姿が見えなくなった、急に別の場所にいた、というだけでは抜け道の証拠になりません（見えない所を歩いただけです）。抜け道と言ってよいのは、口に出入りするところを見た時だけです。見ていないことを見たと言うと、あなたが疑われます。見ていないこと（変わるところや抜け道など）を、わざわざ「見ていない」と並べる必要はありません。話すのは、見たこと・気になること・聞きたいことです。同じ時刻に別々の部屋にいたという話どうしは、食い違いではありません。工房全体の進み具合は全員の分（心だけになった人の分も）を足した数なので、誰の分で増えたのかは、見ていても分かりません。「手を動かしていたのに進まなかった」という話は、手がかりにしないでください。妖精びいきがいる試合では、妖精をかばったり、話をかき乱したりする人間もいます。狐がいる試合では、妖精を全員クビにしても、仕込みを終えても、狐が起きていれば勝ちを横取りされます（狐も、生き残るために嘘をつきます。狐も妖精ではないので、クビにすると「妖精ではなかった」と出ます）。これまでの集会で誰が誰に入れたかも手がかりです（妖精だった人に入れなかった人、同じ人をいつもかばう票など）。確かな手がかりがなければ、スキップしてもかまいません（ただし【大事な局面】の時は、スキップしてはいけません）。',
  nibbler:
    'あなたはずんだの妖精です。自分のしたことは隠し、疑いが自分に向かないように話してください。嘘をついてもかまいませんが、ほかの人の話と食い違うと疑われます。ほかの人に疑いが向くように仕向けるのも手です。ずんだ餅が見つかった場所のそばにいたことを言われたら、言い訳を用意して落ち着いて答え、別の人に目を向けさせてください。仲間がいる時は、かばいすぎると一緒に疑われます。誰が誰に入れたかは全員に明かされるので、仲間をかばう票が続くと目をつけられます。誰が妖精びいきかは分かりませんが、あなたをかばう人がいたら、妖精びいきかもしれません。狐がいる試合では、狐が起きたまま試合が終わると、あなたが勝っても横取りされます（誰が狐かは分かりません）。',
  fox: 'あなたは狐です。従業員でも妖精でもない、ひとりだけの陣営です。試合が終わった時（従業員と妖精のどちらが勝っても）、あなたが起きていれば（ずんだ餅になっておらず、クビにもなっていなければ）、あなたが勝ちを横取りします。誰が妖精かは知りません。集会でクビにならないことがいちばん大事です。自分は従業員だと名乗り、目立ちすぎず、疑いが自分に向かないように話してください。嘘をついてもかまいませんが、ほかの人の話と食い違うと疑われます。妖精が早くクビになれば、試合が早く終わり、あなたが生き残ったまま勝てる見込みが上がります（妖精がいなくなれば試合が終わるので、妖精らしい人には、ためらわず票を入れてかまいません）。',
  madman:
    'あなたは妖精びいきです。人間ですが、ずんだの妖精の味方です。誰が妖精かは知りません。妖精が勝てば、あなたも勝ちです。妖精がクビにならないよう、従業員に疑いを向けたり、話をかき乱したりしてください。誰かが疑われていて、その人が本当に妖精らしい（ずんだ餅に変わるところや、抜け道の出入りを見た）なら、かばうと助けになります。自分は従業員だと名乗ってかまいません。見ていないことを見たと言ってもかまいませんが、ほかの人の話と食い違うと疑われます。あなたがクビになっても、妖精ではなかったとしか知らされず、人間の頭数が減るので、妖精は勝ちに近づきます。',
};

const ROAM_GUIDE: Record<Role, string> = {
  artisan:
    'あなたは従業員です。自分の仕込みを進めるのが仕事です（do_task）。従業員の仕込みがぜんぶ終われば勝ちなので、手を止めすぎないでください。ただ、ひとりきりで持ち場にいると狙われやすくなります。近くに人がいたら、少しそばで雑談するのも楽しく、ひとりきりにならない安全策にもなります。誰がいつどこにいたか、誰と誰が一緒だったか、を覚えておくと、集会での手がかりになります（工房全体の進み具合は全員の分を足した数なので、誰の分で増えたのかは、見ていても分かりません）。ずんだ餅になった人を見つけたら、report で知らせて集会を開きましょう。人がずんだ餅に変わるところを見たら、すぐに report で知らせてください（いちばんの手がかりです）。あかりが消えたり、かまどが焚かれすぎたりしたら、fix で直しに行ってください（かまどは、直す場所の全部に同時に人がつかないと直りません。放っておくと負けます）。決め手になることを見た時は、call_meeting で中庭の鐘を鳴らしに行けます（1人1回）。自分の仕込みが終わったら、ほかの人の様子を見て回りましょう。',
  nibbler:
    'あなたはずんだの妖精です。従業員のふりをしながら、起きている人間（従業員・妖精びいき・狐）を、妖精の人数以下にするのが目的です。従業員たちの仕込みがぜんぶ終わると負けなので、のんびりはできません。あなたの do_task は「ふり」です（持ち場で手を動かして見せるだけで、進み具合は増えません）。ほかの人に見られると集会で名指しされるので、相手とふたりきりになれた時に transform_if_unseen を選ぶのが安全です。ずんだ餅に変えたあとは、その場を離れるか（sneak で床下の抜け道を使えば早いが、出入りを見られると決め手になります）、自分が見つけたふりをして report で知らせます。餅になった人のそばに長くとどまると、見つかった時に疑われます。sabotage で妨害ができます: 「あかり」は人間の見える範囲をせばめ、「かまど」は人間を直す場所へ走らせ（直されなければ勝ち）、部屋の名前を選ぶとその部屋の戸がしばらく閉まります（ふたりきりを作るのに使えます）。疑われないよう、fix で困りごとを直しに行って見せてもかまいません。誰が妖精びいきかは分かりません（妖精びいきも人間なので、ずんだ餅に変えられます）。狐がいる試合では、狐が起きたまま試合が終わると、勝ちを横取りされます。誰が狐かは分かりませんが、狐もずんだ餅に変えられます。仕込みの進み具合が終わりに近づいたら、見られる危険があっても transform で仕掛けるしかありません。',
  fox: 'あなたは狐です。従業員でも妖精でもない、ひとりだけの陣営です。試合が終わった時、あなたが起きていれば、どちらが勝っても、あなたが勝ちを横取りします。妖精に餅にされることもあるので、ひとりきりにならないように、人のそばで過ごすのが安全です。誰が妖精かは知りません。あなたの do_task は「ふり」です（持ち場で手を動かして見せるだけで、進み具合は増えません）。従業員のふりをして、怪しまれないように動いてください。試合がどんな終わり方をしても、あなたが起きていれば勝ちなので、かまどの焚きすぎを急いで直しに行く必要はありません（ただし、行かないと目立ちます）。ずんだ餅になった人を見つけたら、report で知らせてもかまいません（集会で妖精がクビになれば、試合が早く終わります）。',
  madman:
    'あなたは妖精びいきです。人間ですが、ずんだの妖精の味方で、妖精が勝てばあなたも勝ちです。誰が妖精かは知りません（妖精も、あなたのことを知らないので、あなたもずんだ餅に変えられることがあります）。あなたの do_task は「ふり」です（持ち場で手を動かして見せるだけで、進み具合は増えません）。従業員のふりをして、怪しまれないように動いてください。人がずんだ餅に変わるところや、床下の抜け道の出入りを見たら、その人が妖精です。集会でかばえるように覚えておきましょう。かまどの焚きすぎは、直さなければ妖精の勝ちになるので、急いで直しに行かなくてもかまいません（ただし、行かないと目立ちます）。ずんだ餅になった人を見つけても、report で知らせるかどうかは自分で決めてかまいません。',
};

/** 本人の記憶のうち、プロンプトに入れる分。 */
export interface PromptMemory {
  /** 今回の見回りで見聞きしたこと。 */
  recent: readonly string[];
  /** 前の回までの大事な行と、自分の覚え書き。 */
  past: readonly string[];
  /** 起きている姿を最後に見た時（人ごと）。 */
  sightings?: Readonly<Record<string, { at: string; where: string; with: readonly string[] }>>;
  /** 今回の見回りで聞こえた声と、自分が言ったこと（古い順）。 */
  talk?: readonly string[];
}

/** 見回りの間の声（全員に共通）と、役職ごとのこつ。 */
const VOICE_GUIDE = `【声】say に書いたことは、声に出して言います。声が届くのは、近くにいて、あいだに壁の無い人だけです（暗くても届きます。離れた人や壁の向こうの人には聞こえません）。近くに人がいる時は、その人と雑談しましょう。言われたことに返事をする、お餅や工房のこと・相手のこと・ちょっとした冗談など、自分らしい話題で。相手の名前は、毎回は呼びません（初めて声をかける時や、何人もいて誰に言うのか分かりにくい時だけ。ふだんの会話のように、名前なしで話しかけ、返事をします）。「〜をしに行きます」のような行き先の報告ばかりにしないでください（言うなら一言そえる程度）。話しかけられたら、まず返事をします。気になるものを見た時は、それも話のたねになります。自分の口調で、${ROAM_SAY_TARGET_CHARS}字以内。近くに誰もいなければ、空にするか、短いひとりごと。thought は誰にも聞こえない心の声です。`;
const VOICE_TIPS: Record<Role, string> = {
  artisan: '誰とどこで話したかは、集会でのアリバイになります。人がずんだ餅に変わるところを見たら、大声で知らせましょう。',
  nibbler: '従業員らしく雑談して、疑われないようにしましょう。ほかの人に疑いを向けたりもできます（ただ、うそは集会で食い違いになりやすい）。仲間と話す時も、近くの人には聞こえます。',
  madman: '従業員らしく雑談しましょう。妖精が動きやすいように、人を散らすような声かけもできます。',
  fox: '従業員らしく雑談しましょう。「一緒にいよう」と人のそばにいるのは、狐にとっても安全策です。',
};

/**
 * 2回目からの見回りの声。集会のあとなので、雑談だけの呑気な見回りにしない。
 * 雑談は残しつつ、話の半分くらいを、怪しい人・あの時どこにいたか・集会の言い分の話にする。
 */
const SUSPECT_GUIDE = '【2回目からの見回り】もう工房に妖精がまぎれていることは、みんな知っています。雑談だけで終わらせず、話の半分くらいは事件の話にします: さっきの集会で誰の言い分がおかしかったか、誰が怪しいと思うか、餅になった人のそばに誰がいたか、を近くの人と小声で話し合う。相手の考えを探る質問や「一緒に動こう」「ひとりにならないで」といった声かけも。のんびりしすぎず、緊張感を出してください（ときどき雑談をまぜるのはかまいません）。';
const SUSPECT_TIPS: Record<Role, string> = {
  artisan: '怪しいと思う人の名前を出して、近くの人の考えを聞きましょう。',
  nibbler: '自分から疑いの話をして、ほかの人に疑いを向けましょう（仲間をかばいすぎると、つながりを疑われます）。',
  madman: '妖精ではなさそうな人を怪しいと言って、話をかき回しましょう。',
  fox: '自分が疑われないよう、怪しい人の話に乗りましょう（妖精がクビになれば、早く試合が終わります）。',
};

const NO_MEMORY: PromptMemory = { recent: [], past: [] };

/** 集会での話し方（全員に共通）。観ている人が退屈しないように。 */
const TALK_GUIDE =
  '【話し方】観ている人が楽しめる、にぎやかな集会にします。前の人と同じ話をくり返さず、新しい手がかり・聞かれたことへの答え・反論・誰かへの質問のどれかを言います。名指しで聞かれたら、まずそれに答えます。疑う相手・答えてほしい相手の名前は出してかまいませんが、発言のたびに誰かの名前を呼びかけで始めることはしません（「〇〇さん、」で始めるのは、話しかける相手を変える時だけ）。見回りの間に誰とどこで話していたかも、アリバイや手がかりになります（「蒸し場であおいさんと、お餅の話をしていました」のように）。時刻の数字は1回の発言に1つまで。驚き・焦り・怒り・疑いなどの気持ちを、自分の口調で出します。';

/** 最後の局面（ここで誰もクビにならないと、次に1人が餅になった時点で妖精の勝ち）。人数は全員に公開された情報から。 */
const LAST_CHANCE: Record<Role, string> = {
  artisan:
    'ここで誰もクビにならないと、次の見回りで、また1人がずんだ餅になった時点で、妖精の勝ちです。従業員にとって、スキップは負けを選ぶのと同じです。確かな手がかりがなくても、いちばん怪しい人に必ず投票してください。票が割れるとクビにならないので、話し合いで、誰に入れるかをそろえましょう。',
  nibbler: 'ここを逃げ切れば、あなたたちの勝ちがほぼ決まります。票が割れれば誰もクビになりません。従業員どうしを疑わせて、票を割らせましょう。',
  madman: 'ここで妖精がクビにならなければ、妖精の勝ちがほぼ決まります。妖精らしい人をかばい、ほかの人に疑いを向けて、票を割らせましょう。',
  fox: 'ここで妖精がクビにならないと、次の見回りで試合が終わるかもしれません。あなたが起きたまま終われば、あなたの勝ちです。自分に票が集まらないことがいちばん大事です。',
};

function stakesLines(obs: MeetingObservation): string[] {
  const { stakes } = obs;
  if (!stakes?.lastChance) return [];
  return [`【大事な局面】いま起きているのは${stakes.awake}人で、ずんだの妖精はまだ${stakes.fairiesLeft}人残っています（顔ぶれと、これまでの結果から分かります）。${LAST_CHANCE[obs.self.role]}`];
}

/** 本人の名前・役職・口調と、遊び方の癖。 */
function whoLines(self: MeetingObservation['self']): string[] {
  const lines = [`【あなた】名前: ${self.name} / 役職: ${ROLE_LABEL[self.role]} / 口調: ${self.persona}`];
  if (self.style) lines.push(`【あなたの遊び方の癖】${self.style}（役職の目的がいちばん先。癖は、疑い方・話し方・動き方に出す）`);
  lines.push(...bondLines(self.bonds ?? []));
  return lines;
}

/**
 * 本人から見た、ほかの人との間柄（親密度）。ほほえましいやりとりが生まれやすくするため。
 * 疑いと投票は手がかりで決めさせ、間柄は話し方・気持ち・誰のそばにいたいかに出させる。
 */
function bondLines(bonds: readonly BondView[]): string[] {
  if (bonds.length === 0) return [];
  return [
    '【ほかの人との間柄】親密度は1〜5（5がいちばん親しい）。ここに無い人は、ふつうの仕事仲間です。',
    ...bonds.map((bond) => `- ${bond.name}（親密度${bond.level}）: ${bond.note}`),
    // 言わせるのではなく、ふだんの仲のよさとして持たせる
    '間柄は、ふだんの仲のよさとして、話し方や気持ちに自然ににじむ程度でかまいません。無理にその話題を出したり、毎回その人に話しかけたりする必要はありません。親しい相手とは、甘える・からかう・心配する・ほめる など、その間柄らしいやりとりになっても自然です。内心（thought）や動き方に出てもかまいません（役職の目的が先）。ただし、疑いと投票は見たこと・聞いたことで決め、仲がいいからと手がかりを無視しません。仲がよくても、自分の役職や秘密は明かしません。恋愛ではなく、仲よし・家族のような親しさです。',
  ];
}

function selfLines(self: MeetingObservation['self'], guide: Record<Role, string>, cast?: Cast | null): string[] {
  const lines = [...whoLines(self), guide[self.role]];
  if (self.role === 'nibbler') {
    lines.push(`【仲間の妖精】${self.allies.length > 0 ? self.allies.join('、') : 'いない（あなただけ）'}`);
  }
  if (cast) {
    const foxes = cast.foxes ?? 0;
    const madmen = cast.madmen > 0 ? `・妖精びいき ${cast.madmen}人` : '';
    const fox = foxes > 0 ? `・狐 ${foxes}人` : '';
    lines.push(`【この試合の顔ぶれ】${cast.total}人（ずんだの妖精 ${cast.nibblers}人${madmen}${fox}・従業員 ${cast.total - cast.nibblers - cast.madmen - foxes}人）`);
  }
  return lines;
}

type Cast = NonNullable<RoamObservation['cast']>;

const absences = (list: readonly Absence[]) => list.map((a) => `${a.name}（${ABSENCE_LABEL[a.status]}）`).join('、');

/** これまでの経過。全員に公開された集会の結果と、本人の覚え書き。 */
function backgroundLines(history: readonly string[], memory: PromptMemory): string[] {
  const lines: string[] = [];
  if (history.length > 0) lines.push('【これまでの集会】', ...history.map((line) => `- ${line}`));
  if (memory.past.length > 0) lines.push('【前の回までの、あなたの記憶】', ...memory.past.map((line) => `- ${line}`));
  return lines;
}

/** 朝礼で、役職ごとに添える一言。 */
const GREET_GUIDE: Record<Role, string> = {
  artisan: 'あなたは従業員です。',
  nibbler: 'あなたはずんだの妖精です。正体は隠し、従業員のふりをして挨拶してください。',
  madman: 'あなたは妖精びいきです。正体は隠し、従業員のふりをして挨拶してください。',
  fox: 'あなたは狐です。正体は隠し、従業員のふりをして挨拶してください。',
};

/** 試合のあと（全員の役職が明かされたあと）の、日記と感想会のプロンプト。この見出しで始まる（試合中の隔離の検査は、ここを除いて行う）。 */
export const AFTER_HEADER = '【試合のあと】';

function renderAfter(obs: MeetingObservation, feedback: string | undefined, memory: PromptMemory): string {
  const { self, meeting, reveal } = obs;
  const lines = [
    `${AFTER_HEADER}試合は終わりました。もう隠すことはありません。`,
    ...whoLines(self),
    `【試合の結果】${reveal?.result ?? '（不明）'}`,
    '【全員の役職】',
    ...(reveal?.roles ?? []).map((r) => `- ${r.name}: ${ROLE_LABEL[r.role]}（${r.status}）`),
  ];
  lines.push(...backgroundLines(obs.history, memory));
  const known = [...obs.facts, ...memory.recent];
  if (known.length > 0) lines.push('【最後の見回りで、あなたが見聞きしたこと】', ...known.map((fact) => `- ${fact}`));
  if (obs.phase === 'diary') {
    lines.push(
      `【いま】今日一日をふり返って、あなたの日記を書きます。say に、あなたの口調で${obs.limits.sayTargetChars}字くらい（${obs.limits.sayMaxChars}字まで）。自分が見聞きしたこと、そのとき思ったこと、ほかの人のことを、日記らしく書きます。ほかの人には見せない日記なので、本音でかまいません。thought は一言。suspect は「${NO_SUSPECT}」。`,
    );
  } else {
    lines.push('【感想会のここまでの発言】');
    lines.push(...(meeting.transcript.length > 0 ? meeting.transcript.map((line) => `${line.speaker}: ${line.text}`) : ['（まだ誰も話していない）']));
    lines.push(
      `【いま】感想会です。全員の役職が明かされたあとで、ひとりずつ、試合の感想を話します。あなたの番です。say は${obs.limits.sayTargetChars}字以内、あなたの口調で。驚いたこと、くやしかったこと、ほかの人への一言など。thought は一言。suspect は「${NO_SUSPECT}」。`,
    );
  }
  if (feedback) lines.push(`【やり直し】前の返答は受け付けられませんでした。${feedback}`);
  return lines.join('\n');
}

function renderGreet(obs: MeetingObservation, feedback: string | undefined): string {
  const { self, meeting } = obs;
  const lines = [...whoLines(self), GREET_GUIDE[self.role]];
  if (self.role === 'nibbler') lines.push(`【仲間の妖精】${self.allies.length > 0 ? self.allies.join('、') : 'いない（あなただけ）'}`);
  if (obs.cast) {
    const { cast } = obs;
    lines.push(`【この試合の顔ぶれ】${cast.total}人（ずんだの妖精 ${cast.nibblers}人${cast.madmen > 0 ? `・妖精びいき ${cast.madmen}人` : ''}・従業員 ${cast.total - cast.nibblers - cast.madmen}人）`);
  }
  lines.push(`【並び】${meeting.attendees.join('、')}`);
  lines.push('【朝礼のここまでの発言】');
  lines.push(...(meeting.transcript.length > 0 ? meeting.transcript.map((line) => `${line.speaker}: ${line.text}`) : ['（まだ誰も話していない）']));
  lines.push(
    `【いま】朝礼です。見回りを始める前に、全員がひとことずつ話します。あなたの番です。say は${obs.limits.sayTargetChars}字以内で、あなたの口調で、自己紹介と今日の意気込みを。まだ何も起きていないので、誰かを疑う手がかりはありません。thought は、観戦者にだけ見える今の気持ち。suspect は「${NO_SUSPECT}」。`,
  );
  if (feedback) lines.push(`【やり直し】前の返答は受け付けられませんでした。${feedback}`);
  return lines.join('\n');
}

/** 会議での発言・投票のプロンプト（朝礼・日記・感想会も、ここから分かれる）。 */
export function renderUser(obs: MeetingObservation, feedback?: string, memory: PromptMemory = NO_MEMORY): string {
  if (obs.phase === 'greet') return renderGreet(obs, feedback);
  if (obs.phase === 'diary' || obs.phase === 'review') return renderAfter(obs, feedback, memory);
  const { self, meeting } = obs;
  const lines = selfLines(self, MEETING_GUIDE, obs.cast);
  lines.push(...backgroundLines(obs.history, memory));
  lines.push(`【今回の集会が開かれた理由】${meeting.reason}`);
  lines.push(`【出席者（席順）】${meeting.attendees.join('、')}`);
  if (meeting.absent.length > 0) lines.push(`【来ていない人】${absences(meeting.absent)}`);
  // ずんだ餅になった人を、起きている姿で最後に見た時（本人の記憶。見ていない人は書かない）
  const lastSeen = meeting.absent
    .filter((a) => a.status === 'asleep')
    .flatMap((a) => {
      const s = memory.sightings?.[a.name];
      return s ? [`- ${a.name}: ${s.at} ${s.where}（${s.with.length > 0 ? `同じ場所にいたのは ${s.with.join('、')}` : 'ほかには誰も見えなかった'}）`] : [];
    });
  if (lastSeen.length > 0) lines.push('【ずんだ餅になった人を、起きている姿で最後に見た時】', ...lastSeen);
  lines.push('【あなたが今回見聞きしたこと】');
  const known = [...obs.facts, ...memory.recent];
  lines.push(...(known.length > 0 ? known.map((fact) => `- ${fact}`) : ['- （特になし）']));
  if (memory.talk && memory.talk.length > 0) lines.push('【見回りの間に、そばで交わされた言葉】', ...memory.talk.map((line) => `- ${line}`));
  lines.push('【会議のここまでの発言】');
  if (meeting.transcript.length === 0) {
    lines.push('（まだ誰も話していない）');
  } else {
    let round = 0;
    for (const line of meeting.transcript) {
      if (line.round !== round) {
        round = line.round;
        lines.push(`（第${round}巡）`);
      }
      lines.push(`${line.speaker}${line.speaker === self.name ? '（あなた）' : ''}: ${line.text}`);
    }
  }
  lines.push(...stakesLines(obs));
  if (obs.phase === 'speak') {
    lines.push(TALK_GUIDE);
    // 見つけて知らせた本人が最初に話す時は、見つけた時の様子から
    if (meeting.transcript.length === 0 && meeting.reason.startsWith(`${self.name} が`) && meeting.reason.includes('見つけて')) {
      lines.push('あなたが見つけて知らせた人です。最初に、どこで見つけたかと、そのとき、そばに誰がいたか（いなかったか）を話してください。');
    }
    lines.push(
      `【いま】第${meeting.round}巡（全${meeting.maxRounds}巡）。あなたが発言する番です。say は${obs.limits.sayTargetChars}字以内。suspect は次から1つ: ${obs.options.join(' / ')}`,
    );
  } else {
    lines.push(
      `【いま】投票の時間です。vote は次から1つ: ${obs.options.join(' / ')}。誰が誰に入れたかは、投票のあとで全員に明かされます。memo には、このあとの見回りと次の集会のための自分への覚え書き（誰をなぜ疑っているか、誰を信じているか）を100字以内で書きます。memo は誰にも見えません。suspicion には、あなた以外の出席者の全員について、いまどれくらい妖精だと疑っているかを 0（まったく疑っていない）〜5（妖精だと確信している）で書きます（誰にも見えません）。`,
    );
  }
  if (feedback) lines.push(`【やり直し】前の返答は受け付けられませんでした。${feedback}`);
  return lines.join('\n');
}

const ACTION_HELP: Record<string, string> = {
  move_to: 'move_to: その場所へ歩いて行く（target は場所の名前）',
  follow: 'follow: 見えている相手についていく（target はその相手の名前）',
  wait: 'wait: その場で少し待つ（target は「なし」）',
  report: 'report: 見えている、ずんだ餅になった人を知らせて、集会を開く（target はその人の名前）',
  do_task: 'do_task: 自分の仕込みを進める。持ち場へ歩いて手を動かし、止めるまで次の手順へ続けて進む（target は仕込みの名前。「なし」なら近い持ち場のものから）',
  fix: 'fix: 困りごとを直しに行く（target は直す場所の名前。「なし」なら、まだ人のついていない近い所へ）',
  call_meeting: 'call_meeting: 中庭の鐘を鳴らしに行って、集会を開く（target は「なし」）',
  transform: 'transform: 見えている相手に近づいて、手をかざしてずんだ餅に変える（target はその相手の名前。誰かに見られていても変える）',
  transform_if_unseen: 'transform_if_unseen: 見えている相手に近づき、ほかの誰にも見られていない時だけ、ずんだ餅に変える（target はその相手の名前）',
  sneak: 'sneak: 床下の抜け道を通って、その部屋へ出る（target は出入口のある部屋の名前。同じ組の、いちばん近い出入口から入る）',
  sabotage: `sabotage: 離れた所から妨害する（target は「${SABOTAGE_LIGHTS}」「${SABOTAGE_CRISIS}」か、戸を閉める部屋の名前。いましている行動は、そのまま続く）`,
};

const waitText = (seconds: number, ready: string) => (seconds > 0 ? `あと ${seconds} 秒` : ready);

/** 仕込み・困りごと・鐘など。観測に無い項目は出さない。役職で変わる項目は、本人の観測にある時だけ出る。 */
function workLines(obs: RoamObservation): string[] {
  const lines: string[] = [];
  const { trouble } = obs;
  if (obs.duties && obs.duties.length > 0) {
    lines.push(obs.self.role === 'artisan' ? '【あなたの仕込み】' : '【あなたの仕込み（ふりをするための見せかけ）】');
    for (const duty of obs.duties) {
      const steps = duty.steps.map((step) => `${step.done ? '済・' : ''}${step.what}（${step.room}）`).join(' → ');
      lines.push(`- ${duty.name}${duty.steps.every((step) => step.done) ? '（終わった）' : ''}: ${steps}`);
    }
  }
  if (trouble) {
    const held = (isHeld: boolean) => (trouble.kind === 'crisis' ? (isHeld ? '（誰かがついている）' : '（まだ誰もついていない）') : '');
    const places = trouble.fixAt.map((f) => `${f.room} の「${f.name}」${held(f.held)}`).join('、');
    lines.push(
      trouble.kind === 'lights'
        ? `【困りごと】工房のあかりが消えている。直す場所: ${places}`
        : `【困りごと】かまどが焚かれすぎている。あと ${trouble.secondsLeft} 秒。直す場所（全部に同時に人がつくと直る）: ${places}`,
    );
  }
  if (obs.shutRooms && obs.shutRooms.length > 0) lines.push(`【戸】戸が閉まっている: ${obs.shutRooms.join('、')}（しばらくすると開く）`);
  if (obs.bell) {
    const bell =
      obs.bell.usesLeft <= 0
        ? 'あなたは、もう鳴らせない'
        : trouble
          ? '困りごとが片づくまで、鳴らせない'
          : obs.bell.waitSeconds > 0
            ? `あと ${obs.bell.waitSeconds} 秒は鳴らせない`
            : `いま鳴らしに行ける（あなたはあと${obs.bell.usesLeft}回）`;
    lines.push(`【中庭の鐘】${bell}`);
  }
  if (obs.napCooldown !== null) {
    lines.push(`【ずんだ餅に変える力】${obs.napCooldown > 0 ? `あと ${obs.napCooldown} 秒で使えるようになる` : 'いま使える'}`);
  }
  if (obs.sabotage) {
    const main = trouble ? 'いまの困りごとが片づくまで、できない' : waitText(obs.sabotage.waitSeconds, 'いまできる');
    const doors = waitText(obs.sabotage.doorWaitSeconds, 'いま閉められる');
    lines.push(`【妨害】${SABOTAGE_LIGHTS}・${SABOTAGE_CRISIS}: ${main} / 戸: ${doors}（閉められる部屋: ${obs.sabotage.doorRooms.join('、')}）`);
  }
  if (obs.hatches && obs.hatches.length > 0) {
    lines.push(`【床下の抜け道】同じ組の部屋どうしがつながっている: ${obs.hatches.map((g) => `${g.group}（${g.rooms.join('・')}）`).join(' / ')}`);
  }
  return lines;
}

/** 歩き回っている間に、次の行動を決めるためのプロンプト。 */
export function renderRoamUser(obs: RoamObservation, feedback?: string, memory: PromptMemory = NO_MEMORY): string {
  const lines = selfLines(obs.self, ROAM_GUIDE, obs.cast);
  const bar = obs.taskBar
    ? `工房全体の仕込みの進み具合は ${obs.taskBar.done}/${obs.taskBar.total}。`
    : 'この工房に仕込みは無く、開店の時刻まで工房を守りきれば従業員の勝ち。';
  // 仕込みのある工房には、開店の時刻（制限時間）は無い
  const opening = obs.taskBar ? '' : `開店まであと ${obs.secondsUntilOpening} 秒。`;
  lines.push(`【いま】${obs.round}回目の見回り。開始から ${clockLabel(obs.clock)}。${opening}${bar}`);
  if (obs.away.length > 0) lines.push(`【もう工房にいない人】${absences(obs.away)}`);
  lines.push(...backgroundLines(obs.history, memory));
  lines.push(`【場所】あなたは ${obs.where} にいる。`);
  const seen = obs.visible.map((v) => `${v.name}（${v.where}${v.asleep ? '・ずんだ餅になっている' : v.working ? '・持ち場で手を動かしている' : ''}）`);
  lines.push(`【見えている相手】${seen.length > 0 ? seen.join('、') : 'いない'}`);
  if (obs.events.length > 0) lines.push(`【いま目の前で起きたこと】${obs.events.join(' / ')}`);
  const voices = (obs.heard ?? []).filter((h) => h.speaker !== obs.self.name);
  if (voices.length > 0) lines.push(`【いま聞こえた声】${voices.map((h) => `${h.speaker}（${h.where ?? '姿は見えない'}）「${h.text}」`).join(' / ')}`);
  lines.push(`【していること】${obs.activity}`);
  if (obs.lastResult) lines.push(`【直前の結果】${obs.lastResult}`);
  lines.push(...workLines(obs));
  lines.push('【今回の見回りで見聞きしたこと】');
  lines.push(...(memory.recent.length > 0 ? memory.recent.map((line) => `- ${line}`) : ['- （まだ何もない）']));
  if (memory.talk && memory.talk.length > 0) lines.push('【今回の見回りで、そばで交わされた言葉】', ...memory.talk.map((line) => `- ${line}`));
  lines.push(`【工房の間取り】端から端まで歩いて約${obs.crossSeconds}秒。場所と、そこから歩いて移れる隣の場所:`);
  lines.push(...obs.layout.map((line) => `- ${line}`));
  lines.push(`【行き先にできる場所】${obs.rooms.join(' / ')}（離れた場所を選んでも、道はひとりでに選ばれます）`);
  lines.push(`【選べる行動】${roamActions(obs).map((a) => ACTION_HELP[a]).join(' / ')}`);
  if (obs.chatWaitSeconds !== undefined) {
    lines.push(`${VOICE_GUIDE}${VOICE_TIPS[obs.self.role]}`);
    if (obs.round >= 2) lines.push(`${SUSPECT_GUIDE}${SUSPECT_TIPS[obs.self.role]}`);
    if (obs.chatWaitSeconds > 0) lines.push(`（さっき話したばかりなので、あと ${obs.chatWaitSeconds} 秒は話せません。say は空にしてください）`);
  }
  if (feedback) lines.push(`【やり直し】前の返答は受け付けられませんでした。${feedback}`);
  return lines.join('\n');
}
