// 字幕に出す文（表示用）から、読み上げに渡す文（読み用）を作る。
// エンジンの辞書は書き換えず、読み用の文の中だけで言葉を置き換える（同じエンジンを使うほかの用途に影響させない）。
// 句読点は消さない。字幕の区切りと、音声の間（ま）を対応させるため。

/** 読みの置き換え。from は表示用の文に出てくる形、to はエンジンに渡す形（カタカナにすると区切りが安定する）。 */
export interface ReadingRule {
  from: string;
  to: string;
}

const EMOJI = /[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu;
// 読み上げで意味の無い記号（括弧は中身を残す）
const SYMBOLS = /[「」『』（）()［］\[\]【】〈〉《》"'＊*＃#＠@＿_｜|＾^｀`]/g;

/** 「0:29」「1:10」のような時刻を「29秒」「1分10秒」にする。 */
export function readClock(text: string): string {
  return text.replace(/(\d{1,2})[:：](\d{2})/g, (_, minutes: string, seconds: string) => {
    const m = Number(minutes);
    const s = Number(seconds);
    if (m === 0) return `${s}秒`;
    return s === 0 ? `${m}分` : `${m}分${s}秒`;
  });
}

/**
 * 記録の発言 → 表示用の文（字幕に出す形）。記録そのものは書き換えない。
 * 工房の時計は分と秒だけ（開店は 7:00）なので、頭脳が「1:13」を「1時13分」と言い換えたものは「1分13秒」に戻す。
 * 分の付かない「1時ごろ」も「1分ごろ」に戻す。
 */
export function displayText(say: string): string {
  return say
    .replace(/([0-9０-９]{1,2})時([0-9０-９]{1,2})分(?!.?秒)/g, (whole, h: string, m: string) => {
      const hours = Number(h.normalize('NFKC'));
      return hours < 10 ? `${h}分${m}秒` : whole;
    })
    .replace(/([0-9０-９]{1,2})時(?![0-9０-９])/g, (whole, h: string) => (Number(h.normalize('NFKC')) < 10 ? `${h}分` : whole));
}

/** 表示用の文 → 読み用の文。rules は長いものから順に当てる。 */
export function toReading(display: string, rules: readonly ReadingRule[] = []): string {
  let text = display.normalize('NFKC').replace(EMOJI, '').replace(SYMBOLS, '');
  text = readClock(text);
  // 「70／83」は、そのままだとエンジンが「ななじゅう、はちじゅうさん」と間を空けて並べて読むので、「83のうち70」にする
  text = text.replace(/(\d{1,4})\s*\/\s*(\d{1,4})/g, '$2のうち$1');
  text = text.replace(/[〜~]/g, 'ー');
  for (const rule of [...rules].sort((a, b) => b.from.length - a.from.length)) {
    text = text.split(rule.from).join(rule.to);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * 句読点のまとまりと空白（区切りとして音声に間ができうるもの）。
 * エンジンは、読み用の文に残した空白でも間を入れる（「わたしは 3秒 あかね が…」は空白ごとに間が入る）。
 * 数字の前の点とカンマ（「2.7」「1,000」）は区切りにしない。エンジンは「にーてんなな」と続けて読み、間を入れない。
 * 中黒（「あかね・あおい・みどり」）では、エンジンが名前ごとに間を入れるので区切る。
 */
export const BREAK = /(?:[、。・！？!?…‥]|[，．,.](?![0-9０-９]))+\s*|\s+/u;

/**
 * 表示用の文を、句読点のまとまりと空白で区切る。区切りの記号と空白は前のかたまりに付ける。
 * 読める文字の無いかたまり（記号だけ）は、前のかたまりにくっつける。文の頭にある時（「……そうだね」）は、次のかたまりにくっつける
 * （エンジンは文の頭の「……」で間を入れない）。
 */
export function splitPhrases(display: string): string[] {
  const parts: string[] = [];
  let rest = display;
  while (rest.length > 0) {
    const m = BREAK.exec(rest);
    if (!m) {
      parts.push(rest);
      break;
    }
    const end = m.index + m[0].length;
    parts.push(rest.slice(0, end));
    rest = rest.slice(end);
  }
  const merged: string[] = [];
  let lead = '';
  for (const part of parts) {
    const readable = /[\p{L}\p{N}]/u.test(part);
    if (!readable && merged.length > 0) merged[merged.length - 1] += part;
    else if (!readable) lead += part;
    else {
      merged.push(lead + part);
      lead = '';
    }
  }
  if (lead) merged.push(lead);
  return merged.filter((part) => part.length > 0);
}
